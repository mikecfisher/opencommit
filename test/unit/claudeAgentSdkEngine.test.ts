import { jest } from '@jest/globals';

const queryMock = jest.fn();
const execaMock = jest.fn();

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock
}));

jest.unstable_mockModule('execa', () => ({
  execa: execaMock
}));

const {
  ClaudeAgentSdkEngine,
  COMMIT_MESSAGE_OUTPUT_SCHEMA,
  formatStructuredCommitMessage,
  normalizeClaudeCodeModel,
  parseStructuredCommitMessage
} = await import('../../src/engine/ClaudeAgentSdkEngine');

const createAsyncIterable = async function* (messages: unknown[]) {
  for (const message of messages) {
    yield message;
  }
};

describe('ClaudeAgentSdkEngine', () => {
  beforeEach(() => {
    queryMock.mockReset();
    execaMock.mockReset();
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: false
      })
    });
  });

  it('parses and formats structured commit output', () => {
    const parsed = parseStructuredCommitMessage({
      subject: 'feat(cli): add structured commit generation',
      body: '- Add Claude Agent SDK adapter',
      breakingFooter: null
    });

    expect(parsed).toEqual({
      subject: 'feat(cli): add structured commit generation',
      body: '- Add Claude Agent SDK adapter',
      breakingFooter: null
    });

    expect(formatStructuredCommitMessage(parsed)).toBe(
      'feat(cli): add structured commit generation\n\n- Add Claude Agent SDK adapter'
    );
  });

  it('rejects invalid BREAKING CHANGE footers', () => {
    expect(() =>
      parseStructuredCommitMessage({
        subject: 'feat(api)!: remove deprecated endpoint',
        body: null,
        breakingFooter: 'Breaking change: use v2'
      })
    ).toThrow('invalid BREAKING CHANGE footer');
  });

  it('maps legacy Anthropic model ids to Claude Code model aliases', () => {
    expect(normalizeClaudeCodeModel('claude-3-5-sonnet-20240620')).toBe(
      'sonnet'
    );
    expect(normalizeClaudeCodeModel('claude-3-opus-20240229')).toBe('opus');
    expect(normalizeClaudeCodeModel('claude-3-haiku-20240307')).toBe('haiku');
    expect(normalizeClaudeCodeModel('claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6'
    );
    expect(normalizeClaudeCodeModel('sonnet')).toBe('sonnet');
  });

  it('uses locked-down query options and formats the final message', async () => {
    queryMock.mockImplementation(() =>
      createAsyncIterable([
        {
          type: 'result',
          subtype: 'success',
          result: 'unused',
          stop_reason: 'end_turn',
          structured_output: {
            subject: 'feat(cli): add Claude Agent SDK commits',
            body: '- Route Anthropic generation through the Agent SDK',
            breakingFooter: null
          }
        }
      ])
    );

    const engine = new ClaudeAgentSdkEngine({
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20240620',
      maxTokensInput: 32000,
      maxTokensOutput: 500,
      reasoningEffort: 'max'
    });

    const result = await engine.generateCommitMessageFromRequest({
      systemPrompt: 'System prompt',
      userPrompt: 'User prompt',
      cwd: '/tmp/opencommit',
      outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
      fallbackMessages: []
    });

    expect(result).toBe(
      'feat(cli): add Claude Agent SDK commits\n\n- Route Anthropic generation through the Agent SDK'
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'User prompt',
      options: expect.objectContaining({
        cwd: '/tmp/opencommit',
        effort: 'max',
        maxTurns: 4,
        model: 'sonnet',
        pathToClaudeCodeExecutable: 'claude',
        outputFormat: {
          type: 'json_schema',
          schema: COMMIT_MESSAGE_OUTPUT_SCHEMA
        },
        permissionMode: 'dontAsk',
        persistSession: false,
        systemPrompt: 'System prompt',
        tools: [],
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'test-key',
          CLAUDE_AGENT_SDK_CLIENT_APP: 'opencommit'
        })
      })
    });
  });

  it('can rely on Claude Code auth when no API key is configured', async () => {
    queryMock.mockImplementation(() =>
      createAsyncIterable([
        {
          type: 'result',
          subtype: 'success',
          result: 'unused',
          stop_reason: 'end_turn',
          structured_output: {
            subject: 'fix(cli): use claude code auth',
            body: null,
            breakingFooter: null
          }
        }
      ])
    );

    const engine = new ClaudeAgentSdkEngine({
      apiKey: '',
      model: 'claude-3-5-sonnet-20240620',
      maxTokensInput: 32000,
      maxTokensOutput: 500
    });

    await engine.generateCommitMessageFromRequest({
      systemPrompt: 'System prompt',
      userPrompt: 'User prompt',
      cwd: '/tmp/opencommit',
      outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
      fallbackMessages: []
    });

    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'User prompt',
      options: expect.objectContaining({
        env: expect.not.objectContaining({
          ANTHROPIC_API_KEY: expect.anything()
        })
      })
    });
  });

  it('omits SDK effort when reasoning effort is none', async () => {
    queryMock.mockImplementation(() =>
      createAsyncIterable([
        {
          type: 'result',
          subtype: 'success',
          result: 'unused',
          stop_reason: 'end_turn',
          structured_output: {
            subject: 'fix(cli): omit explicit effort',
            body: null,
            breakingFooter: null
          }
        }
      ])
    );

    const engine = new ClaudeAgentSdkEngine({
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20240620',
      maxTokensInput: 32000,
      maxTokensOutput: 500,
      reasoningEffort: 'none'
    });

    await engine.generateCommitMessageFromRequest({
      systemPrompt: 'System prompt',
      userPrompt: 'User prompt',
      cwd: '/tmp/opencommit',
      outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
      fallbackMessages: []
    });

    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'User prompt',
      options: expect.not.objectContaining({
        effort: expect.anything()
      })
    });
  });

  it('prefers Claude Code auth over a configured API key when claude.ai login is active', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai'
      })
    });

    queryMock.mockImplementation(() =>
      createAsyncIterable([
        {
          type: 'result',
          subtype: 'success',
          result: 'unused',
          stop_reason: 'end_turn',
          structured_output: {
            subject: 'fix(cli): prefer claude auth',
            body: null,
            breakingFooter: null
          }
        }
      ])
    );

    const engine = new ClaudeAgentSdkEngine({
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20240620',
      maxTokensInput: 32000,
      maxTokensOutput: 500
    });

    await engine.generateCommitMessageFromRequest({
      systemPrompt: 'System prompt',
      userPrompt: 'User prompt',
      cwd: '/tmp/opencommit',
      outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
      fallbackMessages: []
    });

    expect(execaMock).toHaveBeenCalledWith('claude', ['auth', 'status']);
    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'User prompt',
      options: expect.objectContaining({
        env: expect.not.objectContaining({
          ANTHROPIC_API_KEY: expect.anything()
        })
      })
    });
  });

  it('maps SDK error result messages into anthropic errors', async () => {
    queryMock.mockImplementation(() =>
      createAsyncIterable([
        {
          type: 'result',
          subtype: 'error_during_execution',
          errors: ['boom'],
          stop_reason: 'end_turn'
        }
      ])
    );

    const engine = new ClaudeAgentSdkEngine({
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20240620',
      maxTokensInput: 32000,
      maxTokensOutput: 500
    });

    await expect(
      engine.generateCommitMessageFromRequest({
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        cwd: '/tmp/opencommit',
        outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
        fallbackMessages: []
      })
    ).rejects.toThrow(
      'anthropic error: Claude query failed (subtype=error_during_execution, stop_reason=end_turn, errors=boom)'
    );
  });
});
