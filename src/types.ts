import type { Logger } from 'pino';
import type { Page } from 'playwright';
import type { NetworkCapture } from './capture';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  promptPath: string;
}

export interface AppConfig {
  baseUrl: string;
  credentials: {
    email: string;
    password: string;
  };
  headless: boolean;
  slowMo: number;
  outputDir: string;
  logLevel: LogLevel;
  globalTimeout: number;
  saveTraces: boolean;
  sessionStatePath: string;
  artifactsDir: string;
  openai: OpenAIConfig;
}

export interface CaptureRule {
  name: string;
  urlPattern: string | RegExp;
  method?: string;
  statusCode?: number;
  transform?: (data: unknown) => unknown;
}

export interface CaptureRecord {
  url: string;
  status: number;
  method: string;
  timestamp: number;
  data: unknown;
}

export interface FlowContext {
  config: AppConfig;
  logger: Logger;
  page?: Page;
  capture?: NetworkCapture;
  params?: Record<string, string | undefined>;
  flowData?: Record<string, unknown>;
}

export interface FlowStep {
  name: string;
  description?: string;
  captureRules?: CaptureRule[];
  action: (ctx: FlowContext) => Promise<void>;
}

export interface FlowDefinition {
  name: string;
  description: string;
  steps: FlowStep[];
}
