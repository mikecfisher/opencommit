import axios from 'axios';
import OpenAI from 'openai';
import { GenerateCommitMessageErrorEnum } from '../generateCommitMessageFromGitDiff';
import { AiEngineConfig } from './Engine';
import { removeContentTags } from '../utils/removeContentTags';
import { tokenCount } from '../utils/tokenCount';

export interface OpenAiConfig extends AiEngineConfig {}

function parseCustomHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) {
    return {};
  }
  return headers;
}

export class OpenAiEngine {
  config: OpenAiConfig;
  client: OpenAI;

  constructor(config: OpenAiConfig) {
    this.config = config;

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: config.apiKey
    };

    if (config.baseURL) {
      clientOptions.baseURL = config.baseURL;
    }

    if (config.customHeaders) {
      const headers = parseCustomHeaders(config.customHeaders);
      if (Object.keys(headers).length > 0) {
        clientOptions.defaultHeaders = headers;
      }
    }

    this.client = new OpenAI(clientOptions);
  }

  public generateCommitMessage = async (
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null> => {
    const params = {
      model: this.config.model,
      messages:
        messages as Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>,
      temperature: 0,
      top_p: 0.1,
      max_tokens: this.config.maxTokensOutput
    };

    try {
      const REQUEST_TOKENS = messages
        .map((msg) => tokenCount(msg.content) + 4)
        .reduce((a, b) => a + b, 0);

      if (
        REQUEST_TOKENS >
        this.config.maxTokensInput - this.config.maxTokensOutput
      )
        throw new Error(GenerateCommitMessageErrorEnum.tooMuchTokens);

      const completion = await this.client.chat.completions.create(params);

      const message = completion.choices[0].message;
      const content = message?.content;
      return removeContentTags(content, 'think');
    } catch (error) {
      const err = error as Error;
      if (
        axios.isAxiosError<{ error?: { message: string } }>(error) &&
        error.response?.status === 401
      ) {
        const openAiError = error.response.data.error;

        if (openAiError) throw new Error(openAiError.message);
      }

      throw err;
    }
  };
}
