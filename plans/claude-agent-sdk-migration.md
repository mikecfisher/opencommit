# Claude Agent SDK Migration Plan

## Goal

Replace the current direct LLM text-generation path with the Claude Agent SDK for commit-message generation, while keeping the CLI behavior stable.

## What the docs change technically

From the Agent SDK TypeScript docs via Context7:

- The primary entrypoint is `query({ prompt, options })`, which returns an async generator of `SDKMessage`s.
- The final output arrives in a `result` message with either:
  - `subtype: "success"` and `result: string`
  - or an error subtype plus `errors: string[]`
- The SDK supports `outputFormat` with JSON schema. That is useful here because commit output is structured and currently validated only indirectly.
- `allowedTools` + `permissionMode: "dontAsk"` can lock the agent down so it cannot edit files, run bash, or prompt for permission.
- `cwd`, `systemPrompt`, `model`, `env`, `maxTurns`, `resume`, `continueConversation`, `hooks`, and `settingSources` are configurable per query.
- `settingSources` defaults to none. `CLAUDE.md` is only loaded if `'project'` is included. For this use case that should stay off initially.

## Current integration points

- `src/generateCommitMessageFromGitDiff.ts` builds the prompt/messages, handles token splitting, and calls the engine.
- `src/utils/engine.ts` selects the current provider implementation.
- `src/engine/UnifiedEngine.ts` is the main AI SDK adapter for OpenAI/Anthropic/Gemini/etc.
- `src/modules/commitlint/config.ts` also uses the same engine to synthesize commitlint consistency config.
- `src/commands/prepare-commit-msg-hook.ts` hard-codes `OCO_API_KEY` presence today.
- `README.md`, wizard/config flows, and model/provider validation are built around a multi-provider abstraction.

## Key decision first

Before coding, decide which migration you actually want:

### Option A: Claude-only migration

Make commit generation use Claude Agent SDK exclusively.

Pros:

- Clean architecture.
- Best fit for the SDK.
- Lets us use structured output and agent-specific controls directly.

Cons:

- Current multi-provider support becomes legacy or must be removed.
- Config UX and docs need a breaking rethink.

### Option B: Hybrid migration

Add a new Claude Agent SDK engine only for Anthropic/Claude paths and keep `UnifiedEngine` for everything else.

Pros:

- Lowest-risk rollout.
- Existing users on OpenAI/Gemini/Ollama/etc. keep working.

Cons:

- Two execution models stay in the codebase.
- Config surface remains more complex.

Recommended: Option B first, then decide later whether to delete the legacy provider layer.

## Recommended target architecture

### 1. Add a dedicated engine

Create `src/engine/ClaudeAgentSdkEngine.ts` with one public method:

- `generateCommitMessage(input: ClaudeCommitRequest): Promise<string>`

That engine should:

- call `query()`
- collect streamed messages
- return only the final `result`
- map SDK result/error subtypes into existing OpenCommit errors
- strip or reject malformed output early

### 2. Stop modeling this as chat-completions

The current engine contract is `messages: Array<{ role, content }>`.

That shape exists because `UnifiedEngine` targets chat-completions. The Agent SDK is prompt-first and tool/session-oriented. Do not force it into the old shape longer than necessary.

Introduce a new internal request shape, for example:

- `systemPrompt: string`
- `userPrompt: string`
- `cwd: string`
- `schema?: object`

Then adapt `generateCommitMessageFromGitDiff.ts` to build that request instead of chat messages.

### 3. Use zero-tool mode initially

For commit generation, the safest initial config is:

- `permissionMode: "dontAsk"`
- `allowedTools: []`
- `maxTurns: 1` or `2`
- no `settingSources`
- `cwd` set to the repo root only for future flexibility

Reason: commit generation already has the diff. It does not need `Read`, `Bash`, `Edit`, or `Glob` in phase 1.

### 4. Use structured output, not free-form text

Use `outputFormat: { type: "json_schema", schema }` and ask the agent for:

- `subject: string`
- `body?: string`
- `breaking_footer?: string`
- `full_message: string`

Or simpler:

- `full_message: string`

Prefer the richer schema so OpenCommit can:

- enforce subject/body/footer assembly itself
- validate line length and breaking-change footer rules deterministically
- keep output stable across retries

### 5. Keep prompt logic, but simplify assembly

Most of `src/prompts.ts` can remain as prompt content. What should change:

- stop building synthetic chat history for the core path
- build one system prompt string and one user prompt string
- keep commitlint prompt generation separate from commit-message prompt generation

## Migration phases

### Phase 0: Decision and compatibility contract

Decide:

- hybrid vs Claude-only
- whether `commitlint` generation also moves now or later
- whether existing `OCO_API_KEY` should remain the user-facing auth config

Exit criteria:

- one-page decision recorded in repo

### Phase 1: Add the Claude Agent SDK adapter

Tasks:

- add `@anthropic-ai/claude-agent-sdk`
- implement `ClaudeAgentSdkEngine`
- support:
  - `systemPrompt`
  - `prompt`
  - `cwd`
  - `model`
  - `permissionMode`
  - `allowedTools`
  - `outputFormat`
  - `maxTurns`
- parse only final `result` messages
- surface SDK error subtypes clearly

Exit criteria:

- unit tests cover success, SDK error result, malformed structured output

### Phase 2: Refactor the generation seam

Tasks:

- replace the message-array contract in `generateCommitMessageFromGitDiff.ts`
- introduce a request model better suited to the Agent SDK
- keep existing diff splitting logic initially
- preserve current breaking-change hint injection

Exit criteria:

- `generateCommitMessageByDiff()` still returns the same string API to callers

### Phase 3: Switch engine selection

Hybrid path:

- in `src/utils/engine.ts`, route Anthropic/Claude usage to `ClaudeAgentSdkEngine`
- leave `UnifiedEngine` for other providers

Claude-only path:

- remove `UnifiedEngine` from the main commit generation path
- deprecate provider switching for commit generation

Exit criteria:

- `oco` generates commit messages through Agent SDK in the chosen scope

### Phase 4: Tighten validation and formatting

Tasks:

- post-process structured output into final commit text
- enforce:
  - single subject line
  - optional body bullets
  - `BREAKING CHANGE:` footer shape
  - line length rules
- keep `removeContentTags()` only if still needed after SDK output validation

Exit criteria:

- malformed or multi-commit outputs are rejected and retried or failed cleanly

### Phase 5: Config and UX cleanup

Tasks:

- update `prepare-commit-msg-hook.ts` auth checks
- update wizard/config descriptions
- document the new execution model in `README.md`
- if Claude-only, deprecate or remove irrelevant provider/model settings

Exit criteria:

- docs and config UX match actual behavior

### Phase 6: Optional second pass for commitlint

`src/modules/commitlint/config.ts` also uses `engine.generateCommitMessage(...)`.

Do not migrate this in the first cut unless needed. It is a separate use case:

- it may benefit from structured JSON output
- but it should not block commit generation migration

Exit criteria:

- explicit decision: migrated now, or left on legacy engine temporarily

## Test plan

Add tests at three levels.

### Unit

- adapter returns final `result` text
- SDK error subtypes map to useful thrown errors
- structured output parse failure is handled
- `permissionMode` and `allowedTools` are set as expected

### Integration

- `generateCommitMessageByDiff()` still works with:
  - small diff
  - split diff
  - breaking change diff
  - one-line commit mode
  - Graphite mode subject-length constraint

### E2E

- `oco` happy path
- `oco --yes`
- prepare-commit-msg hook flow
- test provider path if hybrid mode is kept

## Main risks

- The biggest architectural mismatch is that the current code is provider-agnostic but the Agent SDK is Claude-specific.
- Auth/config may need to stop pretending all providers are interchangeable.
- For this use case, enabling tools would be unnecessary risk. Start with no tools.
- If you keep the old `messages[]` engine contract, the migration will be awkward and incomplete.

## Recommended execution order

1. Add the new engine without switching production flow.
2. Refactor the request contract away from `messages[]`.
3. Switch Anthropic/Claude traffic to Agent SDK.
4. Add structured output validation.
5. Clean up config/docs.
6. Decide whether to migrate or delete the legacy provider path.
