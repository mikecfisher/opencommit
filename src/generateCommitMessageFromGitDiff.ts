import { DEFAULT_TOKEN_LIMITS, getConfig } from './commands/config';
import { getMainCommitPrompt } from './prompts';
import {
  analyzeBreakingChanges,
  BreakingChangeHint
} from './utils/breakingChange';
import { getEngine } from './utils/engine';
import { debug } from './utils/logger';
import { mergeDiffs } from './utils/mergeDiffs';
import { tokenCount } from './utils/tokenCount';

interface Message {
  role: string;
  content: string;
}

const config = getConfig();
const MAX_TOKENS_INPUT = config.OCO_TOKENS_MAX_INPUT;
const MAX_TOKENS_OUTPUT = config.OCO_TOKENS_MAX_OUTPUT;

const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  fullGitMojiSpec: boolean,
  context: string,
  breakingChangeHints: BreakingChangeHint[] = []
): Promise<Array<Message>> => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(
    fullGitMojiSpec,
    context,
    breakingChangeHints
  );

  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  chatContextAsCompletionRequest.push({
    role: 'user',
    content: diff
  });

  return chatContextAsCompletionRequest;
};

export const GenerateCommitMessageErrorEnum = {
  tooMuchTokens: 'TOO_MUCH_TOKENS',
  internalError: 'INTERNAL_ERROR',
  emptyMessage: 'EMPTY_MESSAGE',
  outputTokensTooHigh: `Token limit exceeded, OCO_TOKENS_MAX_OUTPUT must not be much higher than the default ${DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_OUTPUT} tokens.`
} as const;

const ADJUSTMENT_FACTOR = 20;

export const generateCommitMessageByDiff = async (
  diff: string,
  fullGitMojiSpec: boolean = false,
  context: string = ''
): Promise<string> => {
  const diffTokens = tokenCount(diff);

  debug('generateCommitMessage', 'Starting', {
    diffLength: diff.length,
    diffTokens,
    hasContext: context.length > 0
  });

  try {
    // Analyze diff for breaking changes if enabled
    const breakingChangeHints = config.OCO_BREAKING_CHANGE
      ? analyzeBreakingChanges(diff)
      : [];

    debug('generateCommitMessage', 'Breaking change analysis', {
      enabled: config.OCO_BREAKING_CHANGE,
      hintsFound: breakingChangeHints.length
    });

    const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(
      fullGitMojiSpec,
      context,
      breakingChangeHints
    );

    const INIT_MESSAGES_PROMPT_LENGTH = INIT_MESSAGES_PROMPT.map(
      (msg) => tokenCount(msg.content as string) + 4
    ).reduce((a, b) => a + b, 0);

    const MAX_REQUEST_TOKENS =
      MAX_TOKENS_INPUT -
      ADJUSTMENT_FACTOR -
      INIT_MESSAGES_PROMPT_LENGTH -
      MAX_TOKENS_OUTPUT;

    debug('generateCommitMessage', 'Token calculation', {
      maxInput: MAX_TOKENS_INPUT,
      maxOutput: MAX_TOKENS_OUTPUT,
      promptTokens: INIT_MESSAGES_PROMPT_LENGTH,
      maxRequestTokens: MAX_REQUEST_TOKENS,
      diffTokens,
      willSplit: diffTokens >= MAX_REQUEST_TOKENS
    });

    if (tokenCount(diff) >= MAX_REQUEST_TOKENS) {
      debug('generateCommitMessage', 'Splitting diff into multiple requests');

      const commitMessagePromises = await getCommitMsgsPromisesFromFileDiffs(
        diff,
        MAX_REQUEST_TOKENS,
        fullGitMojiSpec,
        breakingChangeHints
      );

      debug('generateCommitMessage', 'Split complete', {
        numRequests: commitMessagePromises.length
      });

      const commitMessages = [] as string[];
      for (const promise of commitMessagePromises) {
        commitMessages.push((await promise) as string);
        await delay(2000);
      }

      return commitMessages.join('\n\n');
    }

    const messages = await generateCommitMessageChatCompletionPrompt(
      diff,
      fullGitMojiSpec,
      context,
      breakingChangeHints
    );

    debug('generateCommitMessage', 'Calling engine', {
      messageCount: messages.length
    });

    const engine = await getEngine();
    const commitMessage = await engine.generateCommitMessage(messages);

    if (!commitMessage)
      throw new Error(GenerateCommitMessageErrorEnum.emptyMessage);

    debug('generateCommitMessage', 'Success', {
      messageLength: commitMessage.length
    });

    return commitMessage;
  } catch (error) {
    throw error;
  }
};

async function getMessagesPromisesByChangesInFile(
  fileDiff: string,
  separator: string,
  maxChangeLength: number,
  fullGitMojiSpec: boolean,
  breakingChangeHints: BreakingChangeHint[] = []
) {
  const hunkHeaderSeparator = '@@ ';
  const [fileHeader, ...fileDiffByLines] = fileDiff.split(hunkHeaderSeparator);

  // merge multiple line-diffs into 1 to save tokens
  const mergedChanges = mergeDiffs(
    fileDiffByLines.map((line) => hunkHeaderSeparator + line),
    maxChangeLength
  );

  const lineDiffsWithHeader = [] as string[];
  for (const change of mergedChanges) {
    const totalChange = fileHeader + change;
    if (tokenCount(totalChange) > maxChangeLength) {
      // If the totalChange is too large, split it into smaller pieces
      const splitChanges = splitDiff(totalChange, maxChangeLength);
      lineDiffsWithHeader.push(...splitChanges);
    } else {
      lineDiffsWithHeader.push(totalChange);
    }
  }

  const engine = await getEngine();
  const commitMsgsFromFileLineDiffs = lineDiffsWithHeader.map(
    async (lineDiff) => {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + lineDiff,
        fullGitMojiSpec,
        '',
        breakingChangeHints
      );

      return engine.generateCommitMessage(messages);
    }
  );

  return commitMsgsFromFileLineDiffs;
}

function splitDiff(diff: string, maxChangeLength: number) {
  const lines = diff.split('\n');
  const splitDiffs = [] as string[];
  let currentDiff = '';

  if (maxChangeLength <= 0) {
    throw new Error(GenerateCommitMessageErrorEnum.outputTokensTooHigh);
  }

  for (let line of lines) {
    // If a single line exceeds maxChangeLength, split it into multiple lines
    while (tokenCount(line) > maxChangeLength) {
      const subLine = line.substring(0, maxChangeLength);
      line = line.substring(maxChangeLength);
      splitDiffs.push(subLine);
    }

    // Check the tokenCount of the currentDiff and the line separately
    if (tokenCount(currentDiff) + tokenCount('\n' + line) > maxChangeLength) {
      // If adding the next line would exceed the maxChangeLength, start a new diff
      splitDiffs.push(currentDiff);
      currentDiff = line;
    } else {
      // Otherwise, add the line to the current diff
      currentDiff += '\n' + line;
    }
  }

  // Add the last diff
  if (currentDiff) {
    splitDiffs.push(currentDiff);
  }

  return splitDiffs;
}

export const getCommitMsgsPromisesFromFileDiffs = async (
  diff: string,
  maxDiffLength: number,
  fullGitMojiSpec: boolean,
  breakingChangeHints: BreakingChangeHint[] = []
) => {
  const separator = 'diff --git ';

  const diffByFiles = diff.split(separator).slice(1);

  // merge multiple files-diffs into 1 prompt to save tokens
  const mergedFilesDiffs = mergeDiffs(diffByFiles, maxDiffLength);

  const commitMessagePromises = [] as Promise<string | null | undefined>[];

  for (const fileDiff of mergedFilesDiffs) {
    if (tokenCount(fileDiff) >= maxDiffLength) {
      // if file-diff is bigger than gpt context — split fileDiff into lineDiff
      const messagesPromises = await getMessagesPromisesByChangesInFile(
        fileDiff,
        separator,
        maxDiffLength,
        fullGitMojiSpec,
        breakingChangeHints
      );

      commitMessagePromises.push(...messagesPromises);
    } else {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + fileDiff,
        fullGitMojiSpec,
        '',
        breakingChangeHints
      );

      const engine = await getEngine();
      commitMessagePromises.push(engine.generateCommitMessage(messages));
    }
  }

  return commitMessagePromises;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
