import {
  text,
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  spinner
} from '@clack/prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import { generateCommitMessageByDiff } from '../generateCommitMessageFromGitDiff';
import {
  assertGitRepo,
  getChangedFiles,
  getDiff,
  getGitDir,
  getStagedFiles,
  gitAdd
} from '../utils/git';
import { debug } from '../utils/logger';
import { trytm } from '../utils/trytm';
import { getConfig } from './config';

const config = getConfig();

const getGitRemotes = async () => {
  const gitDir = await getGitDir();
  const { stdout } = await execa('git', ['remote'], { cwd: gitDir });
  return stdout.split('\n').filter((remote) => Boolean(remote.trim()));
};

/**
 * Check if Graphite CLI is installed
 */
const assertGraphiteInstalled = async (): Promise<void> => {
  try {
    await execa('gt', ['--version']);
  } catch {
    throw new Error(
      'Graphite CLI (gt) is not installed. Install it with: npm install -g @withgraphite/graphite-cli'
    );
  }
};

/**
 * Check if GitHub CLI is installed
 */
const assertGhInstalled = async (): Promise<void> => {
  try {
    await execa('gh', ['--version']);
  } catch {
    throw new Error(
      'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/'
    );
  }
};

type ParsedGitRemote = {
  host: string;
  repo: string;
};

const parseGitRemote = (remoteUrl: string): ParsedGitRemote | null => {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], repo: sshMatch[2] };
  }

  const sshUrlMatch = trimmed.match(
    /^ssh:\/\/git@([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?$/
  );
  if (sshUrlMatch) {
    return { host: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }

  const httpsMatch = trimmed.match(
    /^https?:\/\/([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return { host: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
};

const getOriginRepoSlug = async (): Promise<string | null> => {
  const gitDir = await getGitDir();
  const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], {
    cwd: gitDir
  });

  const parsed = parseGitRemote(stdout);
  if (!parsed) return null;
  if (parsed.host === 'github.com') return parsed.repo;
  return `${parsed.host}/${parsed.repo}`;
};

const pushToOriginForPr = async (): Promise<void> => {
  const gitDir = await getGitDir();
  const pushSpinner = spinner();

  pushSpinner.start(`Running 'git push -u origin HEAD'`);

  const { stdout } = await execa('git', ['push', '-u', 'origin', 'HEAD'], {
    cwd: gitDir
  });

  pushSpinner.stop(`${chalk.green('✔')} Successfully pushed all commits to origin`);

  if (stdout) outro(stdout);
};

const createPullRequest = async (): Promise<void> => {
  const gitDir = await getGitDir();
  await assertGhInstalled();
  const repoSlug = await getOriginRepoSlug();
  const ghArgs = ['pr', 'create', '--fill'];
  if (repoSlug) {
    ghArgs.push('-R', repoSlug);
  }
  await execa('gh', ghArgs, {
    cwd: gitDir,
    stdio: 'inherit'
  });
};

/**
 * Maps git commit extra args to gt create compatible args
 */
const buildGraphiteArgs = (
  commitMessage: string,
  extraArgs: string[]
): string[] => {
  const gtArgs: string[] = ['-m', commitMessage];

  // Mapping of compatible args
  const argMapping: Record<string, string> = {
    '--all': '--all',
    '-a': '-a',
    '--no-verify': '--no-verify',
    '-n': '--no-verify'
  };

  // Args that don't apply to gt create
  const unsupportedArgs = [
    '--amend',
    '--signoff',
    '-s',
    '--gpg-sign',
    '-S',
    '--fixup',
    '--squash'
  ];

  for (const arg of extraArgs) {
    if (argMapping[arg]) {
      gtArgs.push(argMapping[arg]);
    } else if (unsupportedArgs.some((u) => arg.startsWith(u))) {
      console.warn(
        chalk.yellow(
          `Warning: '${arg}' is not supported with Graphite and will be ignored`
        )
      );
    } else {
      // Pass through unknown args
      gtArgs.push(arg);
    }
  }

  return gtArgs;
};

// Check for the presence of message templates
const checkMessageTemplate = (extraArgs: string[]): string | false => {
  for (const key in extraArgs) {
    if (extraArgs[key].includes(config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER))
      return extraArgs[key];
  }
  return false;
};

interface GenerateCommitMessageFromGitDiffParams {
  diff: string;
  extraArgs: string[];
  context?: string;
  fullGitMojiSpec?: boolean;
  skipCommitConfirmation?: boolean;
  createPr?: boolean;
  useGraphite?: boolean;
}

const generateCommitMessageFromGitDiff = async ({
  diff,
  extraArgs,
  context = '',
  fullGitMojiSpec = false,
  skipCommitConfirmation = false,
  createPr = false,
  useGraphite = false
}: GenerateCommitMessageFromGitDiffParams): Promise<void> => {
  await assertGitRepo();

  debug('commit', 'Starting commit message generation', {
    diffLength: diff.length,
    hasContext: context.length > 0,
    fullGitMojiSpec,
    skipCommitConfirmation
  });

  const commitGenerationSpinner = spinner();
  commitGenerationSpinner.start('Generating the commit message');

  try {
    debug('commit', 'Calling generateCommitMessageByDiff');

    let commitMessage = await generateCommitMessageByDiff(
      diff,
      fullGitMojiSpec,
      context,
      useGraphite
    );

    debug('commit', 'Received commit message', {
      messageLength: commitMessage.length
    });

    const messageTemplate = checkMessageTemplate(extraArgs);
    if (
      config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER &&
      typeof messageTemplate === 'string'
    ) {
      const messageTemplateIndex = extraArgs.indexOf(messageTemplate);
      extraArgs.splice(messageTemplateIndex, 1);

      commitMessage = messageTemplate.replace(
        config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
        commitMessage
      );
    }

    commitGenerationSpinner.stop('📝 Commit message generated');

    outro(
      `Generated commit message:
${chalk.grey('——————————————————')}
${commitMessage}
${chalk.grey('——————————————————')}`
    );

    const userAction = skipCommitConfirmation
      ? 'Yes'
      : await select({
          message: 'Confirm the commit message?',
          options: [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
            { value: 'Edit', label: 'Edit' }
          ]
        });

    if (isCancel(userAction)) process.exit(1);

    if (userAction === 'Edit') {
      const textResponse = await text({
        message: 'Please edit the commit message: (press Enter to continue)',
        initialValue: commitMessage
      });

      commitMessage = textResponse.toString();
    }

    if (userAction === 'Yes' || userAction === 'Edit') {
      const committingChangesSpinner = spinner();

      let stdout: string;
      if (useGraphite) {
        await assertGraphiteInstalled();
        committingChangesSpinner.start('Creating Graphite stack');
        const gtArgs = buildGraphiteArgs(commitMessage, extraArgs);
        const result = await execa('gt', ['create', ...gtArgs], { stdin: 'inherit' });
        stdout = result.stdout;
        committingChangesSpinner.stop(
          `${chalk.green('✔')} Successfully created Graphite branch`
        );
      } else {
        committingChangesSpinner.start('Committing the changes');
        const result = await execa('git', [
          'commit',
          '-m',
          commitMessage,
          ...extraArgs
        ], { stdin: 'inherit' });
        stdout = result.stdout;
        committingChangesSpinner.stop(
          `${chalk.green('✔')} Successfully committed`
        );
      }

      outro(stdout);

      // Skip push workflow for Graphite - users should use gt submit
      if (useGraphite) {
        outro(chalk.dim('Use `gt submit` to push your Graphite stack'));
        if (createPr) {
          outro(chalk.dim('Skipping PR creation because Graphite is enabled'));
        }
        return;
      }

      const remotes = await getGitRemotes();

      if (createPr) {
        if (!remotes.includes('origin')) {
          throw new Error(
            "No 'origin' remote found. Add one with: git remote add origin <url>"
          );
        }

        await pushToOriginForPr();
        await createPullRequest();
        return;
      }

      // user isn't pushing, return early
      if (config.OCO_GITPUSH === false) return;

      if (!remotes.length) {
        const { stdout } = await execa('git', ['push']);
        if (stdout) outro(stdout);
        process.exit(0);
      }

      if (remotes.length === 1) {
        const isPushConfirmedByUser = await confirm({
          message: 'Do you want to run `git push`?',
          initialValue: false
        });

        if (isCancel(isPushConfirmedByUser)) process.exit(1);

        if (isPushConfirmedByUser) {
          const pushSpinner = spinner();

          pushSpinner.start(`Running 'git push ${remotes[0]}'`);

          const { stdout } = await execa('git', [
            'push',
            '--verbose',
            remotes[0]
          ]);

          pushSpinner.stop(
            `${chalk.green('✔')} Successfully pushed all commits to ${
              remotes[0]
            }`
          );

          if (stdout) outro(stdout);
        } else {
          outro('`git push` aborted');
          process.exit(0);
        }
      } else {
        const skipOption = `don't push`;
        const selectedRemote = (await select({
          message: 'Choose a remote to push to',
          options: [...remotes, skipOption].map((remote) => ({
            value: remote,
            label: remote
          }))
        })) as string;

        if (isCancel(selectedRemote)) process.exit(1);

        if (selectedRemote !== skipOption) {
          const pushSpinner = spinner();

          pushSpinner.start(`Running 'git push ${selectedRemote}'`);

          const { stdout } = await execa('git', ['push', selectedRemote]);

          if (stdout) outro(stdout);

          pushSpinner.stop(
            `${chalk.green(
              '✔'
            )} successfully pushed all commits to ${selectedRemote}`
          );
        }
      }
    } else {
      const regenerateMessage = await confirm({
        message: 'Do you want to regenerate the message?'
      });

      if (isCancel(regenerateMessage)) process.exit(1);

      if (regenerateMessage) {
        await generateCommitMessageFromGitDiff({
          diff,
          extraArgs,
          fullGitMojiSpec,
          createPr,
          useGraphite
        });
      }
    }
  } catch (error) {
    commitGenerationSpinner.stop(
      `${chalk.red('✖')} Failed to generate the commit message`
    );

    console.log(error);

    const err = error as Error;
    outro(`${chalk.red('✖')} ${err?.message || err}`);
    process.exit(1);
  }
};

export async function commit(
  extraArgs: string[] = [],
  context: string = '',
  isStageAllFlag: Boolean = false,
  fullGitMojiSpec: boolean = false,
  skipCommitConfirmation: boolean = false,
  createPr: boolean = false,
  useGraphite: boolean = false
) {
  debug('commit', 'Commit function called', {
    extraArgsCount: extraArgs.length,
    hasContext: context.length > 0,
    isStageAllFlag,
    fullGitMojiSpec,
    skipCommitConfirmation
  });

  if (isStageAllFlag) {
    const changedFiles = await getChangedFiles();

    if (changedFiles) await gitAdd({ files: changedFiles });
    else {
      outro('No changes detected, write some code and run `oco` again');
      process.exit(1);
    }
  }

  const [stagedFiles, errorStagedFiles] = await trytm(getStagedFiles());
  const [changedFiles, errorChangedFiles] = await trytm(getChangedFiles());

  if (!changedFiles?.length && !stagedFiles?.length) {
    outro(chalk.red('No changes detected'));
    process.exit(1);
  }

  intro('open-commit');
  if (errorChangedFiles ?? errorStagedFiles) {
    outro(`${chalk.red('✖')} ${errorChangedFiles ?? errorStagedFiles}`);
    process.exit(1);
  }

  const stagedFilesSpinner = spinner();

  stagedFilesSpinner.start('Counting staged files');

  if (stagedFiles.length === 0) {
    stagedFilesSpinner.stop('No files are staged');

    const isStageAllAndCommitConfirmedByUser = await confirm({
      message: 'Do you want to stage all files and generate commit message?'
    });

    if (isCancel(isStageAllAndCommitConfirmedByUser)) process.exit(1);

    if (isStageAllAndCommitConfirmedByUser) {
      await commit(
        extraArgs,
        context,
        true,
        fullGitMojiSpec,
        skipCommitConfirmation,
        createPr,
        useGraphite
      );
      process.exit(0);
    }

    if (stagedFiles.length === 0 && changedFiles.length > 0) {
      const files = (await multiselect({
        message: chalk.cyan('Select the files you want to add to the commit:'),
        options: changedFiles.map((file) => ({
          value: file,
          label: file
        }))
      })) as string[];

      if (isCancel(files)) process.exit(0);

      await gitAdd({ files });
    }

    await commit(
      extraArgs,
      context,
      false,
      fullGitMojiSpec,
      skipCommitConfirmation,
      createPr,
      useGraphite
    );
    process.exit(0);
  }

  stagedFilesSpinner.stop(
    `${stagedFiles.length} staged files:\n${stagedFiles
      .map((file) => `  ${file}`)
      .join('\n')}`
  );

  const [, generateCommitError] = await trytm(
    generateCommitMessageFromGitDiff({
      diff: await getDiff({ files: stagedFiles }),
      extraArgs,
      context,
      fullGitMojiSpec,
      skipCommitConfirmation,
      createPr,
      useGraphite
    })
  );

  if (generateCommitError) {
    outro(`${chalk.red('✖')} ${generateCommitError}`);
    process.exit(1);
  }

  process.exit(0);
}
