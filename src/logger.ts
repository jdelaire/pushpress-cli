import pino, { Logger } from 'pino';
import { AppConfig, LogLevel } from './types';

interface LoggerOptions {
  level?: LogLevel;
}

export function createLogger(config: AppConfig, options: LoggerOptions = {}): Logger {
  const level = options.level ?? config.logLevel;
  const pretty = process.stdout.isTTY;

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({ level });
}
