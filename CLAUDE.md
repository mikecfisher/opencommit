# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCommit (oco) is a CLI tool that generates meaningful git commit messages using AI. It supports multiple LLM providers (OpenAI, Anthropic, Gemini, Azure, Ollama, Mistral, Groq, DeepSeek, OpenRouter, AI/ML API) and follows conventional commit conventions.

## Common Commands

```bash
# Development
npm run dev                    # Run CLI from TypeScript source
npm run build                  # Build production bundle with esbuild
npm run start                  # Run built CLI

# Testing
npm run test                   # Run unit tests
npm run test:unit              # Run unit tests with Jest experimental VM modules
npm run test:e2e               # Run e2e tests (requires setup)
npm run test:e2e:setup         # Setup e2e test environment

# Docker testing (isolated)
npm run test:unit:docker       # Build Docker image and run unit tests
npm run test:e2e:docker        # Build Docker image and run e2e tests

# Linting/Formatting
npm run lint                   # ESLint + TypeScript check
npm run format                 # Prettier format
npm run format:check           # Prettier check

# Running with specific providers
OCO_AI_PROVIDER='ollama' npm run start
OCO_AI_PROVIDER='gemini' npm run dev
```

## Architecture

### Entry Points
- `src/cli.ts` - Main CLI entry point using cleye for argument parsing
- `src/github-action.ts` - GitHub Action entry point for CI workflows

### Core Flow
1. **CLI** (`src/cli.ts`) parses flags and invokes `commit()` or `prepareCommitMessageHook()`
2. **Commit** (`src/commands/commit.ts`) handles git operations and user interaction via @clack/prompts
3. **Diff Processing** (`src/generateCommitMessageFromGitDiff.ts`) splits large diffs, manages token limits, orchestrates AI calls
4. **Prompt Generation** (`src/prompts.ts`) builds system/user prompts with GitMoji, conventional commits, breaking change detection
5. **Engine** (`src/engine/UnifiedEngine.ts`) routes to appropriate AI provider using Vercel AI SDK

### AI Provider Architecture
`UnifiedEngine` uses Vercel AI SDK (`ai` package) with provider-specific SDKs:
- `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.
- Handles token counting, model-specific options (reasoning effort for o-series models)
- Custom headers and base URL support for proxies/self-hosted

### Configuration System
Config priority (lowest to highest):
1. **Global config**: `~/.opencommit` (INI format)
2. **Per-repo config**: `.opencommit.jsonc` (JSONC with friendly key names like `model`, `emoji`)
3. **Local env**: `.env` file in project root

- Config keys defined in `CONFIG_KEYS` enum (`src/commands/config.ts`)
- Validation via `configValidators` object
- Key providers: `OCO_AI_PROVIDER`, models: `OCO_MODEL`, tokens: `OCO_TOKENS_MAX_INPUT/OUTPUT`
- Per-repo config supports `customPrompt.instructions` for project-specific prompt additions
- API keys blocked from `.opencommit.jsonc` for security

### Prompt Modules
Two modes controlled by `OCO_PROMPT_MODULE`:
- `conventional-commit` (default) - Standard conventional commits with optional GitMoji
- `@commitlint` - Integrates with project's commitlint config, generates `.opencommit-commitlint` file

### Git Hook Integration
- `oco hook set/unset` - Installs `prepare-commit-msg` hook
- Hook handled by `src/commands/prepare-commit-msg-hook.ts`
- Integrates with IDE source control workflows

### Migrations
`src/migrations/` contains versioned config migrations run on startup via `runMigrations()`.

## Key Files

- `src/commands/config.ts` - Config keys, validators, MODEL_LIST, per-repo JSONC parsing
- `src/commands/wizard.ts` - Interactive setup wizard
- `src/engine/UnifiedEngine.ts` - AI SDK integration, provider routing
- `src/generateCommitMessageFromGitDiff.ts` - Token management, diff splitting logic
- `src/prompts.ts` - Prompt templates, GitMoji specs, breaking change instructions, custom prompt support
- `src/utils/breakingChange.ts` - Breaking change detection (removed exports, changed signatures)
- `src/utils/git.ts` - Git operations (diff, staging, etc.)
- `src/utils/logger.ts` - Debug logging system (`--debug` flag)
- `src/utils/tokenCount.ts` - Token counting using tiktoken

## Build System

Uses esbuild (`esbuild.config.js`) to bundle:
- `src/cli.ts` -> `out/cli.cjs`
- `src/github-action.ts` -> `out/github-action.cjs`
- Copies tiktoken WASM file to `out/`

TypeScript config targets ES2020, uses NodeNext module resolution.

## Testing Notes

- Unit tests in `test/unit/`, e2e tests in `test/e2e/`
- Jest with experimental VM modules for ESM support
- Use `cli-testing-library` for e2e CLI testing
- Test AI provider: `OCO_AI_PROVIDER=test` with `OCO_TEST_MOCK_TYPE` for mocking
