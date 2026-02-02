import fs from 'fs';
import path from 'path';
import { BrowserContext, Page } from 'playwright';
import type { Logger } from 'pino';
import { AppConfig } from './types';

export function sessionStateExists(config: AppConfig): boolean {
  return fs.existsSync(config.sessionStatePath);
}

export function ensureSessionStateDir(config: AppConfig): void {
  const dir = path.dirname(config.sessionStatePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function deleteSessionState(config: AppConfig): void {
  if (fs.existsSync(config.sessionStatePath)) {
    fs.rmSync(config.sessionStatePath);
  }
}

export async function saveSessionState(
  context: BrowserContext,
  config: AppConfig
): Promise<void> {
  ensureSessionStateDir(config);
  await context.storageState({ path: config.sessionStatePath });
}

function isLoginUrl(url: string): boolean {
  return url.includes('/login');
}

async function getLoginIndicators(page: Page): Promise<{
  hasLoginForm: boolean;
  localStorageKeys: string[];
  sessionStorageKeys: string[];
}> {
  return page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;

    const labelsToCheck = ['username/email', 'email', 'password', 'log in'];
    let hasLoginForm = false;

    if (root) {
      const nodes = root.querySelectorAll('[aria-label]');
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;
        const label = (el.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (labelsToCheck.some((target) => label.includes(target))) {
          hasLoginForm = true;
          break;
        }
      }
    }

    if (!hasLoginForm) {
      const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
      if (labelsToCheck.some((target) => bodyText.includes(target))) {
        hasLoginForm = true;
      }
    }

    return {
      hasLoginForm,
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
    };
  });
}

function hasAuthLikeKeys(keys: string[]): boolean {
  const needles = ['token', 'auth', 'session', 'jwt', 'user', 'member'];
  return keys.some((key) => needles.some((needle) => key.toLowerCase().includes(needle)));
}

async function hasSemanticsLabel(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((label) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const wanted = label.replace(/\s+/g, ' ').trim().toLowerCase();
    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const labelValue = (el.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (labelValue === wanted || labelValue.includes(wanted)) {
        return true;
      }
    }

    return false;
  }, labelText);
}

async function enableFlutterSemantics(
  page: Page,
  config: AppConfig,
  logger?: Logger
): Promise<void> {
  await page
    .locator('flt-glass-pane')
    .waitFor({ state: 'attached', timeout: config.globalTimeout })
    .catch(() => undefined);

  const clicked = await page.evaluate(() => {
    const glass = document.querySelector('flt-glass-pane');
    const root = glass && 'shadowRoot' in glass && (glass as HTMLElement).shadowRoot
      ? (glass as HTMLElement).shadowRoot
      : glass;
    if (!root) {
      return false;
    }

    const placeholder = root.querySelector('flt-semantics-placeholder');
    if (!placeholder) {
      return false;
    }

    (placeholder as HTMLElement).click();
    return true;
  });

  logger?.debug({ clicked }, 'Flutter semantics placeholder click attempted');
  await page.waitForTimeout(250);
}

export async function validateSession(
  page: Page,
  config: AppConfig,
  logger?: Logger
): Promise<boolean> {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await enableFlutterSemantics(page, config, logger);

  const start = Date.now();
  let lastSnapshot = '';
  let lastLogTime = 0;

  while (Date.now() - start < config.globalTimeout) {
    const indicators = await getLoginIndicators(page);
    const navLabels = ['Home', 'Schedule', 'Workouts', 'Social'];
    let hasNav = false;
    for (let i = 0; i < navLabels.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const found = await hasSemanticsLabel(page, navLabels[i]).catch(() => false);
      if (found) {
        hasNav = true;
        break;
      }
    }
    const hasGetStarted = await hasSemanticsLabel(page, "Let's get started").catch(() => false);

    const snapshot = JSON.stringify({
      hasLoginForm: indicators.hasLoginForm,
      hasNav,
      hasGetStarted,
      localStorageKeys: indicators.localStorageKeys,
      sessionStorageKeys: indicators.sessionStorageKeys,
    });

    const now = Date.now();
    if (snapshot !== lastSnapshot || now - lastLogTime > 2000) {
      logger?.debug(JSON.parse(snapshot), 'Session validation check');
      lastSnapshot = snapshot;
      lastLogTime = now;
    }

    if (hasNav && !indicators.hasLoginForm) {
      return true;
    }

    if (hasGetStarted || indicators.hasLoginForm) {
      return false;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

export async function waitForLoginSuccess(
  page: Page,
  config: AppConfig,
  logger?: Logger
): Promise<void> {
  const start = Date.now();
  let lastIndicators = await getLoginIndicators(page);

  if (!lastIndicators.hasLoginForm) {
    return;
  }

  while (Date.now() - start < config.globalTimeout) {
    const indicators = await getLoginIndicators(page);
    lastIndicators = indicators;
    const authLike = hasAuthLikeKeys([
      ...indicators.localStorageKeys,
      ...indicators.sessionStorageKeys,
    ]);

    logger?.debug(
      {
        hasLoginForm: indicators.hasLoginForm,
        localStorageKeys: indicators.localStorageKeys,
        sessionStorageKeys: indicators.sessionStorageKeys,
        authLike,
      },
      'Login success check'
    );

    if (!indicators.hasLoginForm && authLike) {
      return;
    }

    if (!indicators.hasLoginForm) {
      return;
    }

    await page.waitForTimeout(500);
  }

  logger?.debug(
    {
      hasLoginForm: lastIndicators.hasLoginForm,
      localStorageKeys: lastIndicators.localStorageKeys,
      sessionStorageKeys: lastIndicators.sessionStorageKeys,
    },
    'Login success check timed out'
  );

  throw new Error('Login did not complete before timeout (login form still visible).');
}
