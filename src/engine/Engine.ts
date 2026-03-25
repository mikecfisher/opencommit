export interface AiEngineConfig {
  apiKey: string;
  model: string;
  maxTokensOutput: number;
  maxTokensInput: number;
  baseURL?: string;
  customHeaders?: Record<string, string>;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
}

export interface CommitMessageRequest {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  outputSchema?: Record<string, unknown>;
  fallbackMessages: Array<{ role: string; content: string }>;
}

export interface AiEngine {
  config: AiEngineConfig;
  client: unknown;
  generateCommitMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null | undefined>;
  generateCommitMessageFromRequest(
    request: CommitMessageRequest
  ): Promise<string | null | undefined>;
}
