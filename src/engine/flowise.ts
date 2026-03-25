import axios, { AxiosInstance } from 'axios';
import { removeContentTags } from '../utils/removeContentTags';
import { AiEngineConfig, CommitMessageRequest } from './Engine';

interface FlowiseAiConfig extends AiEngineConfig {}

export class FlowiseEngine {
  config: FlowiseAiConfig;
  client: AxiosInstance;

  constructor(config: FlowiseAiConfig) {
    this.config = config;
    this.client = axios.create({
      url: `${config.baseURL}/${config.apiKey}`,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async generateCommitMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string | undefined> {
    const gitDiff = (messages[messages.length - 1]?.content as string)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    const payload = {
      question: gitDiff,
      overrideConfig: {
        systemMessagePrompt: messages[0]?.content
      },
      history: messages.slice(1, -1)
    };
    try {
      const response = await this.client.post('', payload);
      const message = response.data;
      const content = message?.text;
      return removeContentTags(content, 'think');
    } catch (err: unknown) {
      const error = err as {
        response?: { data?: { error?: string } };
        message?: string;
      };
      const message = error.response?.data?.error ?? error.message;
      throw new Error('local model issues. details: ' + message);
    }
  }

  async generateCommitMessageFromRequest(
    request: CommitMessageRequest
  ): Promise<string | undefined> {
    return this.generateCommitMessage(request.fallbackMessages);
  }
}
