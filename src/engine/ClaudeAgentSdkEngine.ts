import { query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { execa } from 'execa';
import {
  AiEngineConfig,
  CommitMessageRequest,
  AiEngine
} from './Engine';
import { GenerateCommitMessageErrorEnum } from '../generateCommitMessageFromGitDiff';
import { debug, error as logError } from '../utils/logger';

type StructuredCommitMessage = {
  subject: string;
  body: string | null;
  breakingFooter: string | null;
};

export const COMMIT_MESSAGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    body: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    },
    breakingFooter: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    }
  },
  required: ['subject', 'body', 'breakingFooter']
} as const;

const CLAUDE_MAX_TURNS = 4;

const CLAUDE_CODE_MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku']);
const CLAUDE_CODE_SUPPORTED_MODEL_PREFIXES = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5'
];

const toClaudeEffort = (
  effort: AiEngineConfig['reasoningEffort']
): 'low' | 'medium' | 'high' | 'max' | undefined => {
  if (!effort || effort === 'none') return undefined;
  return effort;
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return normalized.length ? normalized : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseStructuredCommitMessage = (
  output: unknown
): StructuredCommitMessage => {
  if (!isRecord(output)) {
    throw new Error('Claude Agent SDK returned invalid structured output');
  }

  const subject = normalizeOptionalText(output.subject);
  if (!subject) {
    throw new Error(GenerateCommitMessageErrorEnum.emptyMessage);
  }

  if (subject.includes('\n')) {
    throw new Error('Claude Agent SDK returned a multi-line subject');
  }

  const body = normalizeOptionalText(output.body);
  const breakingFooter = normalizeOptionalText(output.breakingFooter);

  if (breakingFooter && !breakingFooter.startsWith('BREAKING CHANGE:')) {
    throw new Error(
      'Claude Agent SDK returned an invalid BREAKING CHANGE footer'
    );
  }

  return {
    subject,
    body,
    breakingFooter
  };
};

export const formatStructuredCommitMessage = ({
  subject,
  body,
  breakingFooter
}: StructuredCommitMessage): string => {
  return [subject, body, breakingFooter].filter(Boolean).join('\n\n');
};

type ClaudeAuthStatus = {
  loggedIn?: boolean;
  authMethod?: string;
};

const parseClaudeAuthStatus = (stdout: string): ClaudeAuthStatus | null => {
  try {
    const parsed = JSON.parse(stdout) as ClaudeAuthStatus;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const shouldPreferClaudeCodeAuth = async (): Promise<boolean> => {
  try {
    const { stdout } = await execa('claude', ['auth', 'status']);
    const status = parseClaudeAuthStatus(stdout);

    return status?.loggedIn === true && status?.authMethod === 'claude.ai';
  } catch {
    return false;
  }
};

const buildClaudeAgentEnv = ({
  apiKey,
  baseEnv,
  baseURL,
  preferClaudeCodeAuth
}: {
  apiKey?: string;
  baseEnv: NodeJS.ProcessEnv;
  baseURL?: string;
  preferClaudeCodeAuth: boolean;
}): NodeJS.ProcessEnv => {
  const { ANTHROPIC_API_KEY: _anthropicApiKey, ...envWithoutAnthropicApiKey } =
    baseEnv;

  return {
    ...envWithoutAnthropicApiKey,
    ...(preferClaudeCodeAuth || !apiKey
      ? {}
      : { ANTHROPIC_API_KEY: apiKey }),
    ...(baseURL ? { ANTHROPIC_BASE_URL: baseURL } : {}),
    CLAUDE_AGENT_SDK_CLIENT_APP: 'opencommit'
  };
};

export const normalizeClaudeCodeModel = (model: string): string => {
  const normalized = model.trim();
  const lowercaseModel = normalized.toLowerCase();

  if (
    CLAUDE_CODE_MODEL_ALIASES.has(lowercaseModel) ||
    CLAUDE_CODE_SUPPORTED_MODEL_PREFIXES.some((prefix) =>
      lowercaseModel.startsWith(prefix)
    )
  ) {
    return normalized;
  }

  if (lowercaseModel.includes('haiku')) return 'haiku';
  if (lowercaseModel.includes('opus')) return 'opus';
  if (lowercaseModel.includes('sonnet')) return 'sonnet';

  return normalized;
};

export class ClaudeAgentSdkEngine implements AiEngine {
  config: AiEngineConfig;
  client: unknown = null;

  constructor(config: AiEngineConfig) {
    this.config = config;
  }

  async generateCommitMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null | undefined> {
    const fallbackRequest: CommitMessageRequest = {
      systemPrompt: messages[0]?.content ?? '',
      userPrompt: messages[messages.length - 1]?.content ?? '',
      cwd: process.cwd(),
      outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
      fallbackMessages: messages
    };

    return this.generateCommitMessageFromRequest(fallbackRequest);
  }

  async generateCommitMessageFromRequest(
    request: CommitMessageRequest
  ): Promise<string | null | undefined> {
    const startTime = Date.now();
    const resolvedModel = normalizeClaudeCodeModel(this.config.model);
    const preferClaudeCodeAuth = await shouldPreferClaudeCodeAuth();
    const effort = toClaudeEffort(this.config.reasoningEffort);

    debug('ClaudeAgentSdkEngine', 'Starting query', {
      model: this.config.model,
      resolvedModel,
      effort: effort ?? 'default',
      authStrategy: preferClaudeCodeAuth ? 'claude.ai' : 'api-key-or-env',
      cwd: request.cwd
    });

    if (resolvedModel !== this.config.model) {
      debug('ClaudeAgentSdkEngine', 'Resolved legacy Anthropic model to Claude Code alias', {
        configuredModel: this.config.model,
        resolvedModel
      });
    }

    let finalResult: SDKResultMessage | null = null;

    const env = buildClaudeAgentEnv({
      apiKey: this.config.apiKey,
      baseEnv: process.env,
      baseURL: this.config.baseURL || process.env.ANTHROPIC_BASE_URL,
      preferClaudeCodeAuth
    });

    try {
      for await (const message of query({
        prompt: request.userPrompt,
        options: {
          cwd: request.cwd,
          env,
          ...(effort ? { effort } : {}),
          maxTurns: CLAUDE_MAX_TURNS,
          model: resolvedModel,
          pathToClaudeCodeExecutable: 'claude',
          outputFormat: {
            type: 'json_schema',
            schema: request.outputSchema ?? COMMIT_MESSAGE_OUTPUT_SCHEMA
          },
          permissionMode: 'dontAsk',
          persistSession: false,
          systemPrompt: request.systemPrompt,
          tools: []
        }
      })) {
        if (message.type === 'result') {
          finalResult = message;
        }
      }

      if (!finalResult) {
        throw new Error(GenerateCommitMessageErrorEnum.emptyMessage);
      }

      debug('ClaudeAgentSdkEngine', 'Query finished', {
        subtype: finalResult.subtype,
        stopReason: finalResult.stop_reason,
        hasStructuredOutput: Boolean(finalResult.structured_output),
        errorCount: finalResult.errors?.length ?? 0,
        durationMs: Date.now() - startTime
      });

      if (finalResult.subtype !== 'success') {
        const details = [
          `subtype=${finalResult.subtype}`,
          finalResult.stop_reason
            ? `stop_reason=${finalResult.stop_reason}`
            : null,
          finalResult.errors.length
            ? `errors=${finalResult.errors.join(' | ')}`
            : null,
          typeof finalResult.result === 'string' && finalResult.result.trim()
            ? `result=${finalResult.result.trim().slice(0, 240)}`
            : null
        ].filter(Boolean);

        throw new Error(
          details.length ? `Claude query failed (${details.join(', ')})` : 'Claude query failed'
        );
      }

      if (!finalResult.structured_output) {
        throw new Error('Claude Agent SDK returned no structured output');
      }

      const parsed = parseStructuredCommitMessage(finalResult.structured_output);
      const commitMessage = formatStructuredCommitMessage(parsed);

      debug('ClaudeAgentSdkEngine', 'Query complete', {
        duration: `${Date.now() - startTime}ms`,
        model: resolvedModel,
        stopReason: finalResult.stop_reason,
        responseLength: commitMessage.length
      });

      return commitMessage;
    } catch (error) {
      const err = error as Error;
      logError('ClaudeAgentSdkEngine', 'Query failed', {
        duration: `${Date.now() - startTime}ms`,
        error: err.message
      });
      throw new Error(`anthropic error: ${err.message}`);
    }
  }
}
