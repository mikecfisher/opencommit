export interface AiEngineConfig {
  apiKey: string;
  model: string;
  maxTokensOutput: number;
  maxTokensInput: number;
  baseURL?: string;
  customHeaders?: Record<string, string>;
}

export interface AiEngine {
  config: AiEngineConfig;
  client: unknown;
  generateCommitMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null | undefined>;
}
