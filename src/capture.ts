import { Page, Response } from 'playwright';
import type { Logger } from 'pino';
import { CaptureRule, CaptureRecord } from './types';

export class NetworkCapture {
  private page: Page;
  private logger: Logger;
  private rules: CaptureRule[] = [];
  private buffer: Record<string, CaptureRecord[]> = {};

  constructor(page: Page, logger: Logger) {
    this.page = page;
    this.logger = logger;
    this.page.on('response', (response) => {
      void this.handleResponse(response);
    });
  }

  setRules(rules: CaptureRule[] = []): void {
    this.rules = rules;
  }

  flush(): Record<string, CaptureRecord[]> {
    const data = this.buffer;
    this.buffer = {};
    return data;
  }

  private async handleResponse(response: Response): Promise<void> {
    if (this.rules.length === 0) {
      return;
    }

    const url = response.url();
    const status = response.status();
    const method = response.request().method();
    const contentType = response.headers()['content-type'] ?? '';

    if (!contentType.includes('application/json')) {
      return;
    }

    for (const rule of this.rules) {
      if (!this.matchesRule(rule, url, method, status)) {
        continue;
      }

      try {
        const json = await response.json().catch(() => null);
        if (json === null) {
          continue;
        }

        const record: CaptureRecord = {
          url,
          status,
          method,
          timestamp: Date.now(),
          data: rule.transform ? rule.transform(json) : json,
        };

        if (!this.buffer[rule.name]) {
          this.buffer[rule.name] = [];
        }
        this.buffer[rule.name].push(record);
      } catch (error) {
        this.logger.debug({ err: error, url }, 'Failed to capture response');
      }
    }
  }

  private matchesRule(
    rule: CaptureRule,
    url: string,
    method: string,
    status: number
  ): boolean {
    const pattern = rule.urlPattern;

    if (pattern !== '*' && pattern !== '') {
      if (typeof pattern === 'string') {
        if (!url.includes(pattern)) {
          return false;
        }
      } else if (!pattern.test(url)) {
        return false;
      }
    }

    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }

    if (rule.statusCode && rule.statusCode !== status) {
      return false;
    }

    return true;
  }
}
