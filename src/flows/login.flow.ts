import { FlowContext, FlowDefinition } from '../types';
import { saveSessionState, waitForLoginSuccess } from '../auth';

const EMAIL_SELECTOR = '[aria-label="Email"], input[type="email"]';
const PASSWORD_SELECTOR = '[aria-label="Password"], input[type="password"]';
const SUBMIT_SELECTOR = '[aria-label="Sign In"], [aria-label="Log In"], button[type="submit"]';
const GET_STARTED_TEXT = /let['’]s get started/i;
const LOGIN_TEXT = /log in/i;

async function enableFlutterSemantics(ctx: FlowContext): Promise<void> {
  const { page, logger, config } = ctx;
  if (!page) {
    throw new Error('FlowContext.page is required to enable semantics.');
  }

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

  logger.debug({ clicked }, 'Flutter semantics placeholder click attempted');
  await page.waitForTimeout(250);
}

async function waitForGetStartedText(page: NonNullable<FlowContext['page']>, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const directCount = await page.getByText(GET_STARTED_TEXT).count().catch(() => 0);
    if (directCount > 0) {
      return;
    }

    const semanticCount = await page
      .locator('flt-semantics-host')
      .getByText(GET_STARTED_TEXT)
      .count()
      .catch(() => 0);
    if (semanticCount > 0) {
      return;
    }

    await page.waitForTimeout(250);
  }
}

async function waitForLoginText(page: NonNullable<FlowContext['page']>, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const directCount = await page.getByText(LOGIN_TEXT).count().catch(() => 0);
    if (directCount > 0) {
      return;
    }

    const semanticCount = await page
      .locator('flt-semantics-host')
      .getByText(LOGIN_TEXT)
      .count()
      .catch(() => 0);
    if (semanticCount > 0) {
      return;
    }

    await page.waitForTimeout(250);
  }
}

async function waitForFieldLabel(
  page: NonNullable<FlowContext['page']>,
  label: RegExp,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const labelCount = await page.getByLabel(label).count().catch(() => 0);
    if (labelCount > 0) {
      return;
    }

    const roleCount = await page.getByRole('textbox', { name: label }).count().catch(() => 0);
    if (roleCount > 0) {
      return;
    }

    const semanticsCount = await page
      .locator('flt-semantics-host')
      .getByText(label)
      .count()
      .catch(() => 0);
    if (semanticsCount > 0) {
      return;
    }

    await page.waitForTimeout(250);
  }
}

async function waitForStablePosition(
  page: NonNullable<FlowContext['page']>,
  label: RegExp,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  let lastY: number | null = null;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const rect = await page.evaluate((labelText) => {
      const host = document.querySelector('flt-semantics-host');
      const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
        ? (host as HTMLElement).shadowRoot
        : host;
      if (!root) {
        return null;
      }

      const wanted = labelText.replace(/\s+/g, ' ').trim().toLowerCase();
      const candidates = root.querySelectorAll('[aria-label]');
      let match: Element | null = null;

      for (let i = 0; i < candidates.length; i += 1) {
        const el = candidates[i] as HTMLElement;
        const labelValue = el.getAttribute('aria-label') ?? '';
        const normalized = labelValue.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized === wanted || normalized.includes(wanted)) {
          match = el;
          break;
        }
      }

      if (!match) {
        return null;
      }

      const box = (match as HTMLElement).getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) {
        return null;
      }

      return { y: box.top };
    }, label.source);

    if (!rect) {
      await page.waitForTimeout(150);
      continue;
    }

    if (lastY !== null && Math.abs(rect.y - lastY) < 1) {
      stableCount += 1;
      if (stableCount >= 5) {
        return;
      }
    } else {
      stableCount = 0;
      lastY = rect.y;
    }

    await page.waitForTimeout(150);
  }
}

async function typeIntoFocusedField(
  page: NonNullable<FlowContext['page']>,
  value: string,
  timeoutMs: number
): Promise<void> {
  const host = page.locator('flt-text-editing-host');
  const input = host.locator('textarea, input, [contenteditable="true"]').first();

  try {
    await input.waitFor({ state: 'attached', timeout: Math.min(2000, timeoutMs) });
    await input.fill('');
    await input.fill(value);
    return;
  } catch {
    // Fallback to keyboard typing if the text editing host isn't available.
  }

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
  await page.keyboard.press('Backspace').catch(() => undefined);
  await page.keyboard.insertText(value);
}

async function clickLoginButton(
  page: NonNullable<FlowContext['page']>,
  config: FlowContext['config'],
  logger: FlowContext['logger']
): Promise<void> {
  const waitForTextTimeout = Math.min(10000, config.globalTimeout);

  logger.debug({ timeout: waitForTextTimeout }, 'Waiting for login button text');
  await waitForLoginText(page, waitForTextTimeout).catch(() => undefined);
  await page.waitForTimeout(150);

  const attempts = [
    { name: 'role-button', locator: page.getByRole('button', { name: LOGIN_TEXT }) },
    { name: 'role-link', locator: page.getByRole('link', { name: LOGIN_TEXT }) },
    { name: 'text', locator: page.getByText(LOGIN_TEXT) },
    { name: 'semantics-text', locator: page.locator('flt-semantics-host').getByText(LOGIN_TEXT) },
  ];

  const perAttemptTimeout = Math.min(2000, config.globalTimeout);

  for (const attempt of attempts) {
    try {
      logger.debug({ selector: attempt.name }, 'Attempting to click login button');
      const handle = await attempt.locator.first().elementHandle({ timeout: perAttemptTimeout }).catch(() => null);
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          logger.debug({ selector: attempt.name }, 'Clicked login button');
          return;
        }
      }
    } catch {
      // continue
    }
  }

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const fallbackX = Math.round(viewport.width / 2);
  const fallbackY = Math.round(viewport.height - 80);
  logger.debug(
    { x: fallbackX, y: fallbackY, width: viewport.width, height: viewport.height },
    'Falling back to coordinate click for login button'
  );
  await page.mouse.click(fallbackX, fallbackY);
}

interface SemanticsFieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  role: string;
}

interface SemanticsCluster {
  y: number;
  fields: SemanticsFieldBox[];
}

function clusterSemanticsFields(
  fields: SemanticsFieldBox[],
  threshold = 40
): SemanticsFieldBox[] {
  const sorted = [...fields].sort((a, b) => a.y - b.y);
  const clusters: SemanticsCluster[] = [];

  for (const field of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(field.y - last.y) < threshold) {
      last.fields.push(field);
    } else {
      clusters.push({ y: field.y, fields: [field] });
    }
  }

  return clusters.map((cluster) => {
    return cluster.fields.reduce((best, current) => {
      const bestArea = best.width * best.height;
      const currentArea = current.width * current.height;
      return currentArea > bestArea ? current : best;
    });
  });
}

async function findSemanticsTextFields(
  page: NonNullable<FlowContext['page']>
): Promise<SemanticsFieldBox[]> {
  return page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [];
    }

    const elements = root.querySelectorAll('[role], [aria-label]');
    const results: SemanticsFieldBox[] = [];

    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i] as HTMLElement;
      const role = (el.getAttribute('role') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const label = el.getAttribute('aria-label') ?? '';
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      const isLikelyField =
        role.includes('textbox') ||
        role.includes('text field') ||
        normalizedLabel.includes('email') ||
        normalizedLabel.includes('username') ||
        normalizedLabel.includes('password');

      if (!isLikelyField) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 120 || rect.height < 24) {
        continue;
      }

      results.push({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        label,
        role,
      });
    }

    return results;
  });
}

async function tryTypeIntoField(
  page: NonNullable<FlowContext['page']>,
  logger: FlowContext['logger'],
  label: RegExp,
  value: string,
  options: { timeoutMs: number; preferInputSelector?: string; ariaLabels?: string[] }
): Promise<boolean> {
  const { timeoutMs, preferInputSelector, ariaLabels } = options;

  if (ariaLabels && ariaLabels.length > 0) {
    for (const ariaLabel of ariaLabels) {
      logger.debug({ selector: `aria-eval-${ariaLabel}`, field: label.source }, 'Attempting to fill field');
      const rect = await page.evaluate((labelText) => {
        const host = document.querySelector('flt-semantics-host');
        const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
          ? (host as HTMLElement).shadowRoot
          : host;
        if (!root) {
          return null;
        }

        const wanted = labelText.replace(/\s+/g, ' ').trim().toLowerCase();
        const candidates = root.querySelectorAll('[aria-label]');
        let match: Element | null = null;

        for (let i = 0; i < candidates.length; i += 1) {
          const el = candidates[i] as HTMLElement;
          const labelValue = el.getAttribute('aria-label') ?? '';
          const normalized = labelValue.replace(/\s+/g, ' ').trim().toLowerCase();
          if (normalized === wanted || normalized.includes(wanted)) {
            match = el;
            break;
          }
        }

        if (!match) {
          return null;
        }

        const box = (match as HTMLElement).getBoundingClientRect();
        if (!box || box.width === 0 || box.height === 0) {
          return null;
        }

        return {
          x: box.left + box.width / 2,
          y: box.top + box.height * 0.7,
        };
      }, ariaLabel);

      if (rect) {
        await page.mouse.click(rect.x, rect.y);
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);
        await page.keyboard.type(value, { delay: 10 });
        return true;
      }
    }
  }

  const attempts = [
    { name: 'label', locator: page.getByLabel(label) },
    { name: 'role-textbox', locator: page.getByRole('textbox', { name: label }) },
    { name: 'placeholder', locator: page.getByPlaceholder(label) },
    { name: 'text', locator: page.getByText(label) },
  ];

  if (preferInputSelector) {
    attempts.unshift({ name: 'preferred-input', locator: page.locator(preferInputSelector) });
  }

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      logger.debug({ selector: attempt.name, field: label.source }, 'Attempting to fill field');
      const target = attempt.locator.first();
      const handle = await target.elementHandle({ timeout: timeoutMs }).catch(() => null);
      if (!handle) {
        continue;
      }

      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);
        await page.keyboard.type(value, { delay: 10 });
        return true;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const semanticsTarget = page.locator('flt-semantics-host').getByText(label).first();
  try {
    logger.debug({ selector: 'semantics-text', field: label.source }, 'Attempting to type via semantics');
    await semanticsTarget.click({ timeout: timeoutMs, force: true });
    await page.keyboard.type(value, { delay: 10 });
    return true;
  } catch (error) {
    lastError = error;
  }

  if (lastError) {
    logger.debug({ field: label.source }, 'Field fill attempt failed');
  }
  return false;
}

async function clickGetStarted(ctx: FlowContext): Promise<void> {
  const { page, config, logger } = ctx;

  if (!page) {
    throw new Error('FlowContext.page is required to open login.');
  }

  const perAttemptTimeout = Math.min(2000, config.globalTimeout);
  const waitForTextTimeout = Math.min(15000, config.globalTimeout);

  await page.locator('flt-semantics-host').waitFor({
    state: 'attached',
    timeout: config.globalTimeout,
  });

  logger.debug({ timeout: waitForTextTimeout }, 'Waiting for get started text');
  await waitForGetStartedText(page, waitForTextTimeout).catch(() => undefined);

  const attempts = [
    { name: 'role-button', locator: page.getByRole('button', { name: GET_STARTED_TEXT }) },
    { name: 'role-link', locator: page.getByRole('link', { name: GET_STARTED_TEXT }) },
    { name: 'text', locator: page.getByText(GET_STARTED_TEXT) },
    { name: 'semantics-text', locator: page.locator('flt-semantics-host').getByText(GET_STARTED_TEXT) },
  ];

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      logger.debug({ selector: attempt.name }, 'Attempting to click get started');
      const handle = await attempt.locator.first().elementHandle({ timeout: perAttemptTimeout }).catch(() => null);

      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          logger.debug(
            { selector: attempt.name, x: Math.round(x), y: Math.round(y) },
            'Clicking get started by bounding box'
          );
          await page.mouse.click(x, y);
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const fallbackX = Math.round(viewport.width / 2);
  const fallbackY = Math.max(1, viewport.height - 60);

  logger.debug(
    { x: fallbackX, y: fallbackY, width: viewport.width, height: viewport.height },
    'Falling back to coordinate click for get started'
  );
  await page.mouse.click(fallbackX, fallbackY);
  return;
}

export const loginFlow: FlowDefinition = {
  name: 'login',
  description: 'Sign in to the PushPress member app',
  steps: [
    {
      name: 'navigate-to-home',
      description: 'Open the members app landing page.',
      action: async (ctx) => {
        await ctx.page!.goto(ctx.config.baseUrl, { waitUntil: 'domcontentloaded' });
        await ctx.page!.waitForTimeout(1000);
      },
    },
    {
      name: 'enable-semantics',
      description: 'Ensure Flutter semantics tree is enabled (if placeholder exists).',
      action: async (ctx) => {
        await enableFlutterSemantics(ctx);
      },
    },
    {
      name: 'open-login',
      description: 'Click “Let’s get started” to open the login window.',
      action: async (ctx) => {
        await clickGetStarted({ page: ctx.page!, config: ctx.config, logger: ctx.logger });
      },
    },
    {
      name: 'fill-credentials',
      description: 'Fill in the email and password fields.',
      action: async (ctx) => {
        const page = ctx.page!;
        const timeoutMs = Math.min(8000, ctx.config.globalTimeout);

        await waitForFieldLabel(page, /username|email/i, timeoutMs);
        await waitForStablePosition(page, /username\/email|email|username/i, timeoutMs);

        const semanticFields = await findSemanticsTextFields(page);
        if (semanticFields.length >= 2) {
          const ordered = clusterSemanticsFields(semanticFields);
          ctx.logger.debug(
            {
              count: ordered.length,
              fields: ordered.slice(0, 2).map((field) => ({
                label: field.label,
                role: field.role,
                x: Math.round(field.x + field.width / 2),
                y: Math.round(field.y + field.height / 2),
              })),
            },
            'Typing into semantics fields by position'
          );

          const emailField = ordered[0];
          const passwordField = ordered[1];

          await page.mouse.click(
            emailField.x + emailField.width / 2,
            emailField.y + emailField.height / 2
          );
          await page.waitForTimeout(150);
          await typeIntoFocusedField(page, ctx.config.credentials.email, timeoutMs);

          await page.mouse.click(
            passwordField.x + passwordField.width / 2,
            passwordField.y + passwordField.height / 2
          );
          await page.waitForTimeout(150);
          await typeIntoFocusedField(page, ctx.config.credentials.password, timeoutMs);
          return;
        }

        const emailLabels = [/username\/email/i, /email/i, /username/i];
        let emailFilled = false;
        for (const label of emailLabels) {
          emailFilled = await tryTypeIntoField(page, ctx.logger, label, ctx.config.credentials.email, {
            timeoutMs: Math.min(1500, timeoutMs),
            preferInputSelector: EMAIL_SELECTOR,
            ariaLabels: ['Username/email', 'Email', 'Username'],
          });
          if (emailFilled) {
            break;
          }
        }

        if (!emailFilled) {
          throw new Error('Failed to fill email/username field.');
        }

        const passwordLabels = [/password/i];
        let passwordFilled = false;
        for (const label of passwordLabels) {
          passwordFilled = await tryTypeIntoField(page, ctx.logger, label, ctx.config.credentials.password, {
            timeoutMs: Math.min(1500, timeoutMs),
            preferInputSelector: PASSWORD_SELECTOR,
            ariaLabels: ['Password'],
          });
          if (passwordFilled) {
            break;
          }
        }

        if (!passwordFilled) {
          throw new Error('Failed to fill password field.');
        }
      },
    },
    {
      name: 'submit-login',
      description: 'Submit the login form (selector may need adjustment).',
      action: async (ctx) => {
        const page = ctx.page!;
        await page.waitForTimeout(300);
        await clickLoginButton(page, ctx.config, ctx.logger);
      },
    },
    {
      name: 'wait-for-login-success',
      description: 'Wait until the app navigates away from the login route.',
      action: async (ctx) => {
        await waitForLoginSuccess(ctx.page!, ctx.config, ctx.logger);
      },
    },
    {
      name: 'save-session',
      description: 'Persist the browser storage state to reuse the session.',
      action: async (ctx) => {
        await saveSessionState(ctx.page!.context(), ctx.config);
      },
    },
  ],
};
