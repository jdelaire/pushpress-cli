import fs from 'fs';
import path from 'path';
import { AppConfig } from './types';

export interface OutputMeta {
  tool: string;
  version: string;
  flow: string;
  appUrl: string;
  timestamp: string;
  durationMs: number;
  stepsCompleted: number;
  stepsTotal: number;
  success: boolean;
}

export interface OutputEnvelope {
  meta: OutputMeta;
  data: Record<string, unknown>;
  errors: string[];
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19).replace(/:/g, '');
}

function writeOutputInternal(
  config: AppConfig,
  flowName: string,
  envelope: OutputEnvelope,
  now: Date,
  suffix: string
): string {
  const datePart = formatDate(now);
  const timePart = formatTime(now);

  const flowDir = path.join(config.outputDir, flowName, datePart);
  fs.mkdirSync(flowDir, { recursive: true });

  const filename = `${flowName}-${timePart}${suffix}.json`;
  const outputPath = path.join(flowDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(envelope, null, 2), 'utf-8');

  return outputPath;
}

export function writeOutput(
  config: AppConfig,
  flowName: string,
  envelope: OutputEnvelope
): string {
  return writeOutputInternal(config, flowName, envelope, new Date(), '');
}

export function writeOutputWithSuffix(
  config: AppConfig,
  flowName: string,
  envelope: OutputEnvelope,
  suffix: string,
  now = new Date()
): string {
  return writeOutputInternal(config, flowName, envelope, now, suffix);
}

export function writeTextOutputWithSuffix(
  config: AppConfig,
  flowName: string,
  content: string,
  suffix: string,
  extension = '.md',
  now = new Date()
): string {
  const datePart = formatDate(now);
  const timePart = formatTime(now);

  const flowDir = path.join(config.outputDir, flowName, datePart);
  fs.mkdirSync(flowDir, { recursive: true });

  const filename = `${flowName}-${timePart}${suffix}${extension}`;
  const outputPath = path.join(flowDir, filename);
  fs.writeFileSync(outputPath, content, 'utf-8');

  return outputPath;
}
