import { FlowContext, FlowDefinition } from '../types';

const WORKOUTS_LABEL = /workouts/i;
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type DayKey = (typeof DAY_ORDER)[number];

interface DayButton {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  number: number;
}

async function clickByLabel(ctx: FlowContext, label: RegExp, labelName: string): Promise<void> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const config = ctx.config;

  const attempts = [
    { name: 'role-button', locator: page.getByRole('button', { name: label }) },
    { name: 'role-link', locator: page.getByRole('link', { name: label }) },
    { name: 'text', locator: page.getByText(label) },
    { name: 'semantics-text', locator: page.locator('flt-semantics-host').getByText(label) },
  ];

  const perAttemptTimeout = Math.min(2000, config.globalTimeout);

  for (const attempt of attempts) {
    try {
      logger.debug({ selector: attempt.name, label: labelName }, 'Attempting to click');
      const handle = await attempt.locator.first().elementHandle({ timeout: perAttemptTimeout }).catch(() => null);
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          logger.debug({ selector: attempt.name, label: labelName }, 'Clicked');
          return;
        }
      }
    } catch {
      // continue
    }
  }

  throw new Error(`Failed to click ${labelName}.`);
}

async function enableFlutterSemantics(ctx: FlowContext): Promise<void> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const config = ctx.config;

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

async function findWeekdayButtons(ctx: FlowContext): Promise<DayButton[]> {
  const page = ctx.page!;

  return page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [];
    }

    const nodes = root.querySelectorAll('[aria-label]');
    const candidates: DayButton[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      const match = label.match(/(\d{1,2})/);
      if (!match) {
        continue;
      }

      const number = Number(match[1]);
      if (!Number.isFinite(number)) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 18 || rect.height < 18) {
        continue;
      }

      if (rect.y > window.innerHeight * 0.85) {
        continue;
      }

      candidates.push({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        label,
        number,
      });
    }

    candidates.sort((a, b) => a.y - b.y);
    const clusters: DayButton[][] = [];

    for (const candidate of candidates) {
      const lastCluster = clusters[clusters.length - 1];
      if (lastCluster && Math.abs(candidate.y - lastCluster[0].y) < 40) {
        lastCluster.push(candidate);
      } else {
        clusters.push([candidate]);
      }
    }

    let bestCluster: DayButton[] = [];
    for (const cluster of clusters) {
      if (cluster.length > bestCluster.length) {
        bestCluster = cluster;
      }
    }

    bestCluster.sort((a, b) => a.x - b.x);
    return bestCluster;
  });
}

async function waitForDayButtons(ctx: FlowContext, timeoutMs: number): Promise<DayButton[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buttons = await findWeekdayButtons(ctx);
    if (buttons.length >= 7) {
      return buttons;
    }
    await ctx.page!.waitForTimeout(300);
  }
  return [];
}

async function dumpSemanticsLabels(ctx: FlowContext): Promise<void> {
  const labels = await ctx.page!.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [] as string[];
    }

    const nodes = root.querySelectorAll('[aria-label]');
    const results: string[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      if (label) {
        results.push(label);
      }
    }

    return results;
  });

  const numeric = labels.filter((label) => /\d/.test(label));
  ctx.logger.debug({ totalLabels: labels.length, numericLabels: numeric.slice(0, 40) }, 'Semantics labels dump');
}

async function clickDayByIndex(ctx: FlowContext, index: number, dayKey: DayKey): Promise<void> {
  const buttons = await waitForDayButtons(ctx, Math.min(10000, ctx.config.globalTimeout));
  if (buttons.length < DAY_ORDER.length) {
    await dumpSemanticsLabels(ctx);
    throw new Error(`Expected ${DAY_ORDER.length} day buttons, found ${buttons.length}.`);
  }

  const button = buttons[index];
  const x = button.x + button.width / 2;
  const y = button.y + button.height / 2;
  ctx.logger.debug({ dayKey, x: Math.round(x), y: Math.round(y), label: button.label }, 'Clicking day button');
  await ctx.page!.mouse.click(x, y);
}

const daySteps = DAY_ORDER.map((dayKey, index) => ({
  name: `capture-${dayKey}`,
  description: `Capture workouts for ${dayKey}.`,
  captureRules: [
    {
      name: 'workouts-week',
      urlPattern: 'workout',
      transform: (data) => ({ day: dayKey, data }),
    },
    {
      name: 'workout-history-week',
      urlPattern: 'history',
      transform: (data) => ({ day: dayKey, data }),
    },
    {
      name: 'week-raw',
      urlPattern: '*',
      transform: (data) => ({ day: dayKey, data }),
    },
  ],
  action: async (ctx: FlowContext) => {
    await clickDayByIndex(ctx, index, dayKey);
    await ctx.page!.waitForTimeout(6000);
  },
}));

export const workoutWeekFlow: FlowDefinition = {
  name: 'workout-week',
  description: 'Capture workout data for each day of the week',
  steps: [
    {
      name: 'navigate-home',
      description: 'Open the members app home screen.',
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
      name: 'open-workouts',
      description: 'Open the Workouts tab in the bottom navigation.',
      action: async (ctx) => {
        await clickByLabel(ctx, WORKOUTS_LABEL, 'Workouts');
        await ctx.page!.waitForTimeout(1500);
      },
    },
    ...daySteps,
  ],
};
