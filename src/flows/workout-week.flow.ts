import { FlowContext, FlowDefinition } from '../types';

const WORKOUTS_LABEL = /workouts/i;
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS = new Set(DAY_ORDER);

type DayKey = (typeof DAY_ORDER)[number];

interface DayButton {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  number: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[\u00a0\u200b\u200c\u200d]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

async function findWorkoutTypeSelector(ctx: FlowContext): Promise<{
  x: number;
  y: number;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
} | null> {
  return ctx.page!.evaluate((dayLabels) => {
    const hosts = Array.from(document.querySelectorAll('flt-semantics-host'));
    const roots = hosts.length
      ? hosts.map((host) => ('shadowRoot' in host && (host as HTMLElement).shadowRoot
        ? (host as HTMLElement).shadowRoot
        : host))
      : [document];

    const candidates: {
      x: number;
      y: number;
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }[] = [];

    for (const root of roots) {
      const nodes = root.querySelectorAll('[aria-label]');

      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;
        const label = (el.getAttribute('aria-label') ?? '').trim();
        if (!label) {
          continue;
        }
        if (label.includes('/')) {
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (!rect || rect.height < 24 || rect.width < 50) {
          continue;
        }

        if (rect.top < 0 || rect.top > window.innerHeight * 0.22) {
          continue;
        }

        const normalized = label.toLowerCase();
        if (normalized.includes('workout')) {
          continue;
        }
        if (dayLabels.includes(normalized)) {
          continue;
        }
        if (/^\d{1,2}$/.test(normalized)) {
          continue;
        }

        candidates.push({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          label,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.top - b.top || a.left - b.left);
    return {
      x: candidates[0].x,
      y: candidates[0].y,
      label: candidates[0].label,
      left: candidates[0].left,
      top: candidates[0].top,
      width: candidates[0].width,
      height: candidates[0].height,
    };
  }, Array.from(DAY_LABELS));
}

async function openWorkoutTypeMenu(
  ctx: FlowContext,
  selector?: { x: number; y: number; label: string; left: number; top: number; width: number; height: number } | null,
  preferArrow = false
): Promise<void> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const workoutType = ctx.params?.workoutType?.trim();

  const exactLabels = [workoutType, 'CrossFit'].filter(
    (value): value is string => Boolean(value)
  );

  for (const label of exactLabels) {
    try {
      await clickByLabel(ctx, new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i'), label);
      return;
    } catch {
      // continue
    }
  }

  const candidate = selector ?? (await findWorkoutTypeSelector(ctx));

  if (candidate) {
    if (preferArrow) {
      const arrowX =
        candidate.left + candidate.width - Math.min(16, Math.max(8, candidate.width * 0.1));
      const arrowY = candidate.top + candidate.height / 2;
      logger.debug(
        { label: candidate.label, arrowX: Math.round(arrowX), arrowY: Math.round(arrowY) },
        'Opening workout type selector (arrow)'
      );
      await page.mouse.click(arrowX, arrowY);
    } else {
      logger.debug({ label: candidate.label }, 'Opening workout type selector (label)');
      await page.mouse.click(candidate.x, candidate.y);
    }
    return;
  }

  const fallbackLabels = [ctx.params?.workoutType?.trim(), 'CrossFit'].filter(
    (value): value is string => Boolean(value)
  );

  for (const label of fallbackLabels) {
    try {
      await clickByLabel(ctx, new RegExp(escapeRegExp(label), 'i'), label);
      return;
    } catch {
      // continue
    }
  }

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const fallbackX = Math.round(viewport.width * 0.94);
  const fallbackY = Math.round(viewport.height * 0.12);
  logger.debug(
    { x: fallbackX, y: fallbackY, width: viewport.width, height: viewport.height },
    'Falling back to coordinate click for workout type selector'
  );
  await page.mouse.click(fallbackX, fallbackY);
}

async function clickWorkoutTypeOption(ctx: FlowContext, workoutType: string): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const normalizedTarget = normalizeLabel(workoutType);
  const pattern = escapeRegExp(workoutType).replace(/\s+/g, '\\s*');

  const match = await page.evaluate((args) => {
    const hosts = Array.from(document.querySelectorAll('flt-semantics-host'));
    const roots = hosts.length
      ? hosts.map((host) => ('shadowRoot' in host && (host as HTMLElement).shadowRoot
        ? (host as HTMLElement).shadowRoot
        : host))
      : [document];

    const candidates: { x: number; y: number; label: string; top: number; left: number }[] = [];

    for (const root of roots) {
      const nodes = root.querySelectorAll('[aria-label]');
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;
        const label = (el.getAttribute('aria-label') ?? '').trim();
        if (!label) {
          continue;
        }
        const normalizedLabel = label
          .replace(/[\u00a0\u200b\u200c\u200d]/g, ' ')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (!normalizedLabel || !normalizedLabel.includes(args.normalizedTarget)) {
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (!rect || rect.height <= 0 || rect.width <= 0) {
          continue;
        }

        candidates.push({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          label,
          top: rect.top,
          left: rect.left,
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.top - b.top || a.left - b.left);
    return { x: candidates[0].x, y: candidates[0].y, label: candidates[0].label };
  }, { normalizedTarget });

  if (match) {
    logger.debug({ workoutType: match.label }, 'Selecting workout type');
    await page.mouse.click(match.x, match.y);
    return true;
  }

  const labelSnapshot = await page
    .evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('flt-semantics-host'));
      const roots = hosts.length
        ? hosts.map((host) => ('shadowRoot' in host && (host as HTMLElement).shadowRoot
          ? (host as HTMLElement).shadowRoot
          : host))
        : [document];
      const labels = new Set<string>();
      for (const root of roots) {
        const nodes = root.querySelectorAll('[aria-label]');
        for (let i = 0; i < nodes.length; i += 1) {
          const label = (nodes[i] as HTMLElement).getAttribute('aria-label');
          if (label) {
            labels.add(label.trim());
          }
        }
      }
      return Array.from(labels);
    })
    .catch(() => []);

  if (labelSnapshot.length > 0) {
    logger.debug(
      { total: labelSnapshot.length, sample: labelSnapshot.slice(0, 30) },
      'Workout type labels snapshot'
    );
  }

  try {
    await clickByLabel(ctx, new RegExp(pattern, 'i'), workoutType);
    return true;
  } catch {
    return false;
  }
}

async function selectWorkoutType(ctx: FlowContext): Promise<void> {
  const workoutType = ctx.params?.workoutType?.trim();
  if (!workoutType) {
    return;
  }

  const selector = await findWorkoutTypeSelector(ctx);
  if (selector && normalizeLabel(selector.label) === normalizeLabel(workoutType)) {
    ctx.logger.debug({ workoutType }, 'Workout type already selected');
    return;
  }

  await openWorkoutTypeMenu(ctx, selector);
  await ctx.page!.waitForTimeout(500);

  let selected = await clickWorkoutTypeOption(ctx, workoutType);
  if (!selected) {
    await openWorkoutTypeMenu(ctx, selector, true);
    await ctx.page!.waitForTimeout(500);
    selected = await clickWorkoutTypeOption(ctx, workoutType);
  }

  if (!selected) {
    throw new Error(`Workout type "${workoutType}" not found.`);
  }

  await ctx.page!.waitForTimeout(1200);
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

async function waitForWorkoutOfDayResponse(ctx: FlowContext, dayKey: DayKey): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const timeoutMs = Math.max(15000, Math.min(45000, ctx.config.globalTimeout));

  try {
    await page.waitForResponse(
      (response) => {
        const url = response.url();
        if (!url.includes('graphql')) {
          return false;
        }
        if (response.request().method().toUpperCase() !== 'POST') {
          return false;
        }
        const postData = response.request().postData() || '';
        if (!postData.includes('workoutOfDay')) {
          return false;
        }
        return response.status() === 200;
      },
      { timeout: timeoutMs }
    );
    logger.debug({ dayKey }, 'Captured workoutOfDay response');
    return true;
  } catch {
    logger.warn({ dayKey, timeoutMs }, 'Timed out waiting for workoutOfDay response');
    return false;
  }
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
    await waitForWorkoutOfDayResponse(ctx, dayKey);
    await ctx.page!.waitForTimeout(2500);
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
    {
      name: 'select-workout-type',
      description: 'Select the requested workout type (if provided).',
      action: async (ctx) => {
        await selectWorkoutType(ctx);
      },
    },
    ...daySteps,
  ],
};
