import { generateText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOllama } from 'ollama-ai-provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OCO_AI_PROVIDER_ENUM } from '../commands/config';
import { AiEngineConfig } from './Engine';
import { removeContentTags } from '../utils/removeContentTags';
import { tokenCount } from '../utils/tokenCount';
import { GenerateCommitMessageErrorEnum } from '../generateCommitMessageFromGitDiff';

export interface UnifiedEngineConfig extends AiEngineConfig {
  provider: OCO_AI_PROVIDER_ENUM;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

// GPT-5 models that should use Responses API
const GPT5_MODELS = [
  'gpt-5',
  'gpt-5.1',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5.1-codex-max'
];

// O-series reasoning models
const O_SERIES_MODELS = [
  'o1',
  'o1-mini',
  'o1-preview',
  'o3',
  'o3-mini',
  'o3-mini-high',
  'o3-pro',
  'o4-mini',
  'o4-mini-high'
];

export class UnifiedEngine {
  config: UnifiedEngineConfig;
  client: unknown = null; // AI SDK manages clients internally

  constructor(config: UnifiedEngineConfig) {
    this.config = config;
  }

  async generateCommitMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null> {
    // Token validation
    const requestTokens = messages
      .map((msg) => tokenCount(msg.content) + 4)
      .reduce((a, b) => a + b, 0);

    if (
      requestTokens >
      this.config.maxTokensInput - this.config.maxTokensOutput
    ) {
      throw new Error(GenerateCommitMessageErrorEnum.tooMuchTokens);
    }

    const model = this.getModel();

    // Convert messages to CoreMessage format
    const coreMessages: CoreMessage[] = messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }));

    try {
      const result = await generateText({
        model,
        messages: coreMessages,
        maxTokens: this.config.maxTokensOutput,
        ...this.getGenerationOptions()
      });

      return removeContentTags(result.text, 'think');
    } catch (error) {
      const err = error as Error;
      throw new Error(`${this.config.provider} error: ${err.message}`);
    }
  }

  private getModel() {
    const { provider, model, apiKey, baseURL } = this.config;

    switch (provider) {
      case OCO_AI_PROVIDER_ENUM.OPENAI: {
        const openai = createOpenAI({
          apiKey,
          baseURL: baseURL || undefined
        });
        // GPT-5 and O-series work with standard openai() call
        // providerOptions handles reasoningEffort in getGenerationOptions()
        return openai(model);
      }

      case OCO_AI_PROVIDER_ENUM.ANTHROPIC: {
        const anthropic = createAnthropic({
          apiKey,
          baseURL: baseURL || undefined
        });
        return anthropic(model);
      }

      case OCO_AI_PROVIDER_ENUM.GEMINI: {
        const google = createGoogleGenerativeAI({
          apiKey,
          baseURL: baseURL || undefined
        });
        return google(model);
      }

      case OCO_AI_PROVIDER_ENUM.AZURE: {
        const azure = createAzure({
          apiKey,
          resourceName: this.extractAzureResourceName(baseURL)
        });
        return azure(model);
      }

      case OCO_AI_PROVIDER_ENUM.MISTRAL: {
        const mistral = createMistral({
          apiKey,
          baseURL: baseURL || undefined
        });
        return mistral(model);
      }

      case OCO_AI_PROVIDER_ENUM.GROQ: {
        const groq = createGroq({ apiKey });
        return groq(model);
      }

      case OCO_AI_PROVIDER_ENUM.DEEPSEEK: {
        const deepseek = createDeepSeek({ apiKey });
        return deepseek(model);
      }

      case OCO_AI_PROVIDER_ENUM.OLLAMA: {
        const ollama = createOllama({
          baseURL: baseURL || 'http://localhost:11434/api'
        });
        return ollama(model);
      }

      case OCO_AI_PROVIDER_ENUM.OPENROUTER: {
        const openrouter = createOpenRouter({ apiKey });
        return openrouter(model);
      }

      case OCO_AI_PROVIDER_ENUM.AIMLAPI: {
        // AI/ML API is OpenAI-compatible
        const aimlapi = createOpenAI({
          apiKey,
          baseURL: 'https://api.aimlapi.com/v1'
        });
        return aimlapi(model);
      }

      case OCO_AI_PROVIDER_ENUM.MLX: {
        // MLX is OpenAI-compatible local server
        const mlx = createOpenAI({
          apiKey: 'not-needed',
          baseURL: baseURL || 'http://localhost:8080/v1'
        });
        return mlx(model);
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private getGenerationOptions(): Record<string, unknown> {
    const { model } = this.config;

    // O-series and GPT-5 reasoning models - no temperature/topP
    if (this.isOSeriesModel(model) || this.isGpt5Model(model)) {
      return {};
    }

    // Standard models - use temperature/topP
    return {
      temperature: 0,
      topP: 0.1
    };
  }

  private isGpt5Model(model: string): boolean {
    return GPT5_MODELS.some((m) => model === m || model.startsWith(`${m}-`));
  }

  private isOSeriesModel(model: string): boolean {
    return O_SERIES_MODELS.some(
      (m) => model === m || model.startsWith(`${m}-`)
    );
  }

  private extractAzureResourceName(baseURL?: string): string {
    // Extract resource name from Azure endpoint URL
    // e.g., https://my-resource.openai.azure.com -> my-resource
    if (!baseURL) return '';
    const match = baseURL.match(/https:\/\/([^.]+)\.openai\.azure\.com/);
    return match?.[1] ?? '';
  }
}
