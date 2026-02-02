import fs from 'fs';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { AppConfig } from './types';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowser(config: AppConfig): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
  });

  const storageState = fs.existsSync(config.sessionStatePath)
    ? config.sessionStatePath
    : undefined;

  const context = await browser.newContext({ storageState });
  context.setDefaultTimeout(config.globalTimeout);

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}
