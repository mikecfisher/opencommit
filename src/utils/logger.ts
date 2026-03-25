import { appendFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';

const LEGACY_LOG_DIR = join(homedir(), '.opencommit');
const FALLBACK_LOG_PATH = join(homedir(), '.opencommit-debug.log');

const resolveLogPath = (): string => {
  if (!existsSync(LEGACY_LOG_DIR)) {
    mkdirSync(LEGACY_LOG_DIR, { recursive: true });
    return join(LEGACY_LOG_DIR, 'debug.log');
  }

  try {
    if (statSync(LEGACY_LOG_DIR).isDirectory()) {
      return join(LEGACY_LOG_DIR, 'debug.log');
    }
  } catch {
    // Fall through to the flat-file path.
  }

  return FALLBACK_LOG_PATH;
};

const LOG_PATH = resolveLogPath();

let debugEnabled = false;
let sessionStartTime: number = 0;

export function enableDebug(): void {
  debugEnabled = true;
  sessionStartTime = Date.now();

  // Write session start marker
  const timestamp = new Date().toISOString();
  const separator = '\n' + '='.repeat(80) + '\n';
  const header = `${separator}[${timestamp}] New debug session started${separator}`;

  try {
    appendFileSync(LOG_PATH, header);
  } catch {
    // Silently fail if we can't write to log file
  }

  console.error(chalk.yellow(`Debug mode enabled. Logging to: ${LOG_PATH}`));
}

function getElapsedTime(): string {
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  return `+${elapsed.toFixed(3)}s`;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

function writeLog(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  context: string,
  message: string,
  data?: unknown
): void {
  if (!debugEnabled) return;

  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  const logLine = `[${timestamp}] [${level}] [${context}] ${message}${dataStr}\n`;

  // Write to file
  try {
    appendFileSync(LOG_PATH, logLine);
  } catch {
    // Silently fail if we can't write to log file
  }

  // Write to console (stderr so it doesn't interfere with normal output)
  const levelColor = {
    DEBUG: chalk.gray,
    INFO: chalk.blue,
    WARN: chalk.yellow,
    ERROR: chalk.red
  };

  const elapsed = chalk.dim(`[${getElapsedTime()}]`);
  const coloredLevel = levelColor[level](`[${level}]`);
  const coloredContext = chalk.cyan(`[${context}]`);
  console.error(
    `${elapsed} ${coloredLevel} ${coloredContext} ${message}${dataStr}`
  );
}

export function debug(context: string, message: string, data?: unknown): void {
  writeLog('DEBUG', context, message, data);
}

export function info(context: string, message: string, data?: unknown): void {
  writeLog('INFO', context, message, data);
}

export function warn(context: string, message: string, data?: unknown): void {
  writeLog('WARN', context, message, data);
}

export function error(context: string, message: string, data?: unknown): void {
  writeLog('ERROR', context, message, data);
}
