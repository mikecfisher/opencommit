#!/usr/bin/env node

import { cli } from 'cleye';

import packageJSON from '../package.json';
import { commit } from './commands/commit';
import { commitlintConfigCommand } from './commands/commitlint';
import { configCommand, getConfig } from './commands/config';
import { hookCommand, isHookCalled } from './commands/githook.js';
import { prepareCommitMessageHook } from './commands/prepare-commit-msg-hook';
import { setupCommand } from './commands/wizard';
import { checkIsLatestVersion } from './utils/checkIsLatestVersion';
import { enableDebug, debug } from './utils/logger';
import { runMigrations } from './migrations/_run.js';

const extraArgs = process.argv.slice(2);

const stripOcoArgs = (argv: string[]): string[] => {
  const ocoBooleanFlags = new Set([
    '--debug',
    '-d',
    '--fgm',
    '--yes',
    '-y',
    '--graphite',
    '-g',
    '--pr'
  ]);
  const ocoValueFlags = new Set(['--context', '-c']);

  const filtered: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (ocoBooleanFlags.has(arg)) continue;
    if (ocoValueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith('--context=')) continue;
    filtered.push(arg);
  }

  return filtered;
};

cli(
  {
    version: packageJSON.version,
    name: 'opencommit',
    commands: [
      configCommand,
      hookCommand,
      commitlintConfigCommand,
      setupCommand
    ],
    flags: {
      debug: {
        type: Boolean,
        alias: 'd',
        description: 'Enable debug logging to ~/.opencommit-debug.log',
        default: false
      },
      fgm: {
        type: Boolean,
        description: 'Use full GitMoji specification',
        default: false
      },
      context: {
        type: String,
        alias: 'c',
        description: 'Additional user input context for the commit message',
        default: ''
      },
      yes: {
        type: Boolean,
        alias: 'y',
        description: 'Skip commit confirmation prompt',
        default: false
      },
      graphite: {
        type: Boolean,
        alias: 'g',
        description: 'Use Graphite (gt create) instead of git commit',
        default: false
      },
      pr: {
        type: Boolean,
        description: 'Auto-push to origin and create a GitHub PR',
        default: false
      }
    },
    ignoreArgv: (type) => type === 'unknown-flag' || type === 'argument',
    help: { description: packageJSON.description }
  },
  async ({ flags }) => {
    if (flags.debug) {
      enableDebug();
      debug('cli', 'OpenCommit started', { version: packageJSON.version });
    }

    await runMigrations();
    await checkIsLatestVersion();

    if (await isHookCalled()) {
      prepareCommitMessageHook();
    } else {
      const config = getConfig();
      const useGraphite = flags.graphite || config.OCO_USE_GRAPHITE;
      const commitArgs = stripOcoArgs(extraArgs);
      commit(
        commitArgs,
        flags.context,
        false,
        flags.fgm,
        flags.yes,
        flags.pr,
        useGraphite
      );
    }
  },
  extraArgs
);
