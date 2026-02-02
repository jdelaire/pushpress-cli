import path from 'path';
import { config as dotenvConfig } from 'dotenv';
import { AppConfig, LogLevel } from './types';

export interface LoadConfigOptions {
  path?: string;
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

const DEFAULT_BASE_URL = 'https://members.pushpress.com';
const DEFAULT_HEADLESS = true;
const DEFAULT_SLOW_MO = 0;
const DEFAULT_OUTPUT_DIR = './output';
const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const DEFAULT_GLOBAL_TIMEOUT = 30000;
const DEFAULT_SAVE_TRACES = false;
const DEFAULT_OPENAI_MODEL = 'gpt-3.5-turbo-16k';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return LOG_LEVELS.includes(normalized as LogLevel) ? (normalized as LogLevel) : fallback;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  dotenvConfig({ path: options.path });

  const env = process.env;
  const baseUrl = env.PUSHPRESS_BASE_URL?.trim() || DEFAULT_BASE_URL;

  const outputDir = env.OUTPUT_DIR?.trim() || DEFAULT_OUTPUT_DIR;
  const artifactsDir = path.resolve('./artifacts');
  const sessionStatePath = path.resolve('./state/session.json');
  const defaultPromptPath = path.resolve('./prompts/workout-week-summary.md');

  return {
    baseUrl,
    credentials: {
      email: env.PUSHPRESS_EMAIL?.trim() || '',
      password: env.PUSHPRESS_PASSWORD?.trim() || '',
    },
    headless: parseBoolean(env.HEADLESS, DEFAULT_HEADLESS),
    slowMo: parseNumber(env.SLOW_MO, DEFAULT_SLOW_MO),
    outputDir,
    logLevel: parseLogLevel(env.LOG_LEVEL, DEFAULT_LOG_LEVEL),
    globalTimeout: parseNumber(env.GLOBAL_TIMEOUT, DEFAULT_GLOBAL_TIMEOUT),
    saveTraces: parseBoolean(env.SAVE_TRACES, DEFAULT_SAVE_TRACES),
    sessionStatePath,
    artifactsDir,
    openai: {
      apiKey: env.OPENAI_API_KEY?.trim() || '',
      model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      promptPath: env.OPENAI_PROMPT_PATH?.trim() || defaultPromptPath,
    },
  };
}

export function validateConfig(config: AppConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (!config.credentials.email) {
    errors.push({
      field: 'PUSHPRESS_EMAIL',
      message: 'Missing email (PUSHPRESS_EMAIL).',
    });
  }

  if (!config.credentials.password) {
    errors.push({
      field: 'PUSHPRESS_PASSWORD',
      message: 'Missing password (PUSHPRESS_PASSWORD).',
    });
  }

  if (!config.baseUrl) {
    errors.push({
      field: 'PUSHPRESS_BASE_URL',
      message: 'Missing base URL (PUSHPRESS_BASE_URL).',
    });
  }

  if (!Number.isFinite(config.slowMo) || config.slowMo < 0) {
    errors.push({
      field: 'SLOW_MO',
      message: 'SLOW_MO must be a non-negative number.',
    });
  }

  if (!Number.isFinite(config.globalTimeout) || config.globalTimeout <= 0) {
    errors.push({
      field: 'GLOBAL_TIMEOUT',
      message: 'GLOBAL_TIMEOUT must be a positive number.',
    });
  }

  if (!LOG_LEVELS.includes(config.logLevel)) {
    errors.push({
      field: 'LOG_LEVEL',
      message: `LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`,
    });
  }

  return errors;
}

export function redactConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    credentials: {
      email: config.credentials.email,
      password: config.credentials.password ? '***' : '',
    },
    openai: {
      ...config.openai,
      apiKey: config.openai.apiKey ? '***' : '',
    },
  };
}
