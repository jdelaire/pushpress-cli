import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import type { Logger } from 'pino';
import type { AppConfig } from './types';

const DEFAULT_PROMPT_PATH = path.resolve('./prompts/workout-week-summary.md');

function buildPrompt(template: string, summaryEnvelope: unknown): string {
  const summaryJson = JSON.stringify(summaryEnvelope, null, 2);
  if (template.includes('generated_json_summary')) {
    return template.replace('generated_json_summary', summaryJson);
  }

  return `${template.trim()}\n\n${summaryJson}`;
}

export async function generateWorkoutWeekMarkdown(
  config: AppConfig,
  summaryEnvelope: unknown,
  logger: Logger
): Promise<string> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY.');
  }

  const promptPath = config.openai.promptPath || DEFAULT_PROMPT_PATH;
  const resolvedPromptPath = path.resolve(promptPath);

  if (!fs.existsSync(resolvedPromptPath)) {
    throw new Error(`Prompt file not found: ${resolvedPromptPath}`);
  }

  const promptTemplate = fs.readFileSync(resolvedPromptPath, 'utf-8');
  const prompt = buildPrompt(promptTemplate, summaryEnvelope);

  logger.info({ model: config.openai.model }, 'Requesting OpenAI markdown summary');

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI response was empty.');
  }

  return content;
}
