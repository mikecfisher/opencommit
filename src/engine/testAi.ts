import { AiEngineConfig, CommitMessageRequest } from './Engine';

export const TEST_MOCK_TYPES = [
  'commit-message',
  'prompt-module-commitlint-config'
] as const;

export type TestMockType = (typeof TEST_MOCK_TYPES)[number];

export class TestAi {
  mockType: TestMockType;
  config: AiEngineConfig | null = null;
  client: unknown = null;

  constructor(mockType: TestMockType) {
    this.mockType = mockType;
  }

  async generateCommitMessage(
    _messages: Array<{ role: string; content: string }>
  ): Promise<string | undefined> {
    switch (this.mockType) {
      case 'commit-message':
        return 'fix(testAi.ts): test commit message';
      case 'prompt-module-commitlint-config':
        return (
          `{\n` +
          `  "localLanguage": "english",\n` +
          `  "commitFix": "fix(server): Change 'port' variable to uppercase 'PORT'",\n` +
          `  "commitFeat": "feat(server): Allow server to listen on a port specified through environment variable",\n` +
          `  "commitDescription": "Change 'port' variable to uppercase 'PORT'. Allow server to listen on a port specified through environment variable."\n` +
          `}`
        );
      default:
        throw Error('unsupported test mock type');
    }
  }

  async generateCommitMessageFromRequest(
    request: CommitMessageRequest
  ): Promise<string | undefined> {
    return this.generateCommitMessage(request.fallbackMessages);
  }
}
