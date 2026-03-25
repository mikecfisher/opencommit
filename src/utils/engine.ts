import {
  getConfig,
  inferProviderFromModel,
  OCO_AI_PROVIDER_ENUM
} from '../commands/config';
import { FlowiseEngine } from '../engine/flowise';
import { TestAi, TestMockType } from '../engine/testAi';
import { debug, warn } from './logger';

// Lazy import for UnifiedEngine to avoid loading AI SDK unless needed
type UnifiedEngineType = import('../engine/UnifiedEngine').UnifiedEngine;

export function parseCustomHeaders(headers: unknown): Record<string, string> {
  let parsedHeaders: Record<string, string> = {};

  if (!headers) {
    return parsedHeaders;
  }

  try {
    if (typeof headers === 'object' && !Array.isArray(headers)) {
      parsedHeaders = headers as Record<string, string>;
    } else if (typeof headers === 'string') {
      parsedHeaders = JSON.parse(headers);
    }
  } catch (error) {
    console.warn(
      'Invalid OCO_API_CUSTOM_HEADERS format, ignoring custom headers'
    );
  }

  return parsedHeaders;
}

export type AiEngine = UnifiedEngineType | FlowiseEngine | TestAi;

export async function getEngine(): Promise<AiEngine> {
  const config = getConfig();
  let provider = config.OCO_AI_PROVIDER;

  // Guard against mismatched provider/model configs (common when switching
  // models via `oco config set model=...` but provider wasn't updated).
  const inferredProvider = inferProviderFromModel(config.OCO_MODEL);
  const canAutoCorrectProvider = [
    OCO_AI_PROVIDER_ENUM.OPENAI,
    OCO_AI_PROVIDER_ENUM.ANTHROPIC,
    OCO_AI_PROVIDER_ENUM.GEMINI
  ].includes(provider);
  if (
    canAutoCorrectProvider &&
    inferredProvider &&
    inferredProvider !== provider
  ) {
    warn('engine', 'OCO_MODEL implies a different provider; overriding', {
      configuredProvider: provider,
      inferredProvider,
      model: config.OCO_MODEL
    });
    provider = inferredProvider;
  }

  debug('engine', 'Getting engine', {
    provider,
    model: config.OCO_MODEL
  });

  // Special cases that don't use AI SDK
  if (provider === OCO_AI_PROVIDER_ENUM.TEST) {
    debug('engine', 'Using TestAi engine');
    return new TestAi(config.OCO_TEST_MOCK_TYPE as TestMockType);
  }

  if (provider === OCO_AI_PROVIDER_ENUM.FLOWISE) {
    debug('engine', 'Using FlowiseEngine');
    return new FlowiseEngine({
      model: config.OCO_MODEL,
      maxTokensOutput: config.OCO_TOKENS_MAX_OUTPUT,
      maxTokensInput: config.OCO_TOKENS_MAX_INPUT,
      baseURL: config.OCO_API_URL ?? '',
      apiKey: config.OCO_API_KEY ?? ''
    });
  }

  // Lazy load UnifiedEngine for all AI SDK providers (including OpenAI)
  debug('engine', 'Loading UnifiedEngine');
  const { UnifiedEngine } = await import('../engine/UnifiedEngine');

  debug('engine', 'UnifiedEngine loaded', {
    provider,
    model: config.OCO_MODEL,
    hasApiKey: Boolean(config.OCO_API_KEY),
    hasBaseURL: Boolean(config.OCO_API_URL)
  });

  return new UnifiedEngine({
    provider,
    model: config.OCO_MODEL,
    maxTokensOutput: config.OCO_TOKENS_MAX_OUTPUT,
    maxTokensInput: config.OCO_TOKENS_MAX_INPUT,
    baseURL: config.OCO_API_URL,
    apiKey: config.OCO_API_KEY ?? '',
    reasoningEffort: config.OCO_REASONING_EFFORT
  });
}
