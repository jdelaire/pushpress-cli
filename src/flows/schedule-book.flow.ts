import { FlowContext, FlowDefinition } from '../types';

const SCHEDULE_LABEL = /schedule/i;
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

interface LabelMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

interface SlotMatch extends LabelMatch {
  classLabel?: LabelMatch;
}

interface BookingRecord {
  day: DayKey;
  time: string;
  className: string;
  label: string;
  status: 'reserved' | 'waitlisted' | 'attempted' | 'skipped' | 'unavailable' | 'unknown';
  note?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTimeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
}

function parseWeekOffset(value?: string): number {
  if (!value) {
    return 0;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'current' || normalized === '0') {
    return 0;
  }
  if (normalized === 'next') {
    return 1;
  }
  const match = normalized.match(/(\d+)/);
  if (match) {
    const offset = Number(match[1]);
    if (Number.isFinite(offset) && offset >= 0) {
      return Math.min(offset, 6);
    }
  }
  return 0;
}

function labelHasReserveSoon(label: string): boolean {
  return label.toLowerCase().includes('reserve soon');
}

async function filterSlotsByClassLabel(
  ctx: FlowContext,
  slots: SlotMatch[],
  classFilter: string
): Promise<SlotMatch[]> {
  if (!slots.length || !classFilter) {
    return slots;
  }

  const matches = await ctx.page!.evaluate(
    ({ slotRects, filterText }) => {
      const host = document.querySelector('flt-semantics-host');
      const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
        ? (host as HTMLElement).shadowRoot
        : host;
      if (!root) {
        return [] as number[];
      }

      const wanted = filterText.trim().toLowerCase();
      if (!wanted) {
        return [] as number[];
      }

      const labelRects: {
        top: number;
        bottom: number;
        left: number;
        right: number;
        centerY: number;
      }[] = [];
      const nodes = root.querySelectorAll('[aria-label]');
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;
        const label = el.getAttribute('aria-label') ?? '';
        if (!label.toLowerCase().includes(wanted)) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 40 || rect.height < 18) {
          continue;
        }
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          continue;
        }
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }
        labelRects.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          centerY: rect.top + rect.height / 2,
        });
      }

      if (labelRects.length === 0) {
        return [] as number[];
      }

      const matchedIndices: number[] = [];
      for (let i = 0; i < slotRects.length; i += 1) {
        const slot = slotRects[i];
        const slotTop = slot.y;
        const slotBottom = slot.y + slot.height;
        const slotCenter = slot.y + slot.height / 2;
        const slotLeft = slot.x;
        const slotRight = slot.x + slot.width;
        const near = labelRects.some((label) => {
          const overlapsY = label.top <= slotBottom && label.bottom >= slotTop;
          const closeY = Math.abs(label.centerY - slotCenter) <= 40;
          const overlapsX = label.left <= slotRight && label.right >= slotLeft;
          return (overlapsY || closeY) && (overlapsX || Math.abs(label.left - slotLeft) <= 200);
        });
        if (near) {
          matchedIndices.push(i);
        }
      }

      return matchedIndices;
    },
    {
      slotRects: slots.map((slot) => ({
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
      })),
      filterText: classFilter,
    }
  );

  if (!matches.length) {
    return [];
  }

  return matches.map((index) => slots[index]).filter(Boolean);
}

async function listVisibleTimes(ctx: FlowContext): Promise<string[]> {
  return ctx.page!.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [];
    }

    const nodes = root.querySelectorAll('[aria-label]');
    const results: string[] = [];
    const timeRegex = /\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i;
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      if (timeRegex.test(label)) {
        results.push(label.trim());
      }
    }
    return results.slice(0, 20);
  });
}

function normalizeDay(input: string): DayKey | null {
  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value.startsWith('su')) return 'sun';
  if (value.startsWith('mo')) return 'mon';
  if (value.startsWith('tu')) return 'tue';
  if (value.startsWith('we')) return 'wed';
  if (value.startsWith('th')) return 'thu';
  if (value.startsWith('fr')) return 'fri';
  if (value.startsWith('sa')) return 'sat';
  return null;
}

function parseDays(param?: string): DayKey[] {
  if (!param) {
    return [];
  }
  const parts = param.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  const days: DayKey[] = [];
  for (const part of parts) {
    const normalized = normalizeDay(part);
    if (normalized && !days.includes(normalized)) {
      days.push(normalized);
    }
  }
  return days;
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

async function tryClickByLabel(ctx: FlowContext, label: RegExp, labelName: string): Promise<boolean> {
  try {
    await clickByLabel(ctx, label, labelName);
    return true;
  } catch {
    return false;
  }
}

async function hasClassFilterPanel(ctx: FlowContext): Promise<boolean> {
  const page = ctx.page!;
  return page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      const normalized = label.toLowerCase();
      if (normalized.includes('class filter') || normalized.includes('class type')) {
        return true;
      }
    }
    return false;
  });
}

async function clickFilterIcon(ctx: FlowContext): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const viewport = page.viewportSize();
  if (!viewport) {
    return false;
  }

  const headerInfo = await page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return null as null | { y: number; right: number; label: string };
    }

    const monthNames = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const nodes = root.querySelectorAll('[aria-label]');
    let best: { y: number; right: number; score: number; label: string } | null = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      if (!label) {
        continue;
      }
      const normalized = label.toLowerCase();
      const hasMonth = monthNames.some((name) => normalized.includes(name));
      const hasDay = dayNames.some((name) => normalized.includes(name));
      const hasNumber = /\b\d{1,2}\b/.test(normalized);
      if (!hasMonth || !hasDay || !hasNumber) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 60 || rect.height < 16) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        continue;
      }
      const hasComma = label.includes(',');
      const hasYear = /\b20\d{2}\b/.test(normalized);
      const score = (hasComma ? 3 : 0) + (hasMonth ? 2 : 0) + (hasDay ? 2 : 0) + (hasYear ? -2 : 0);
      const y = rect.top + rect.height / 2;
      if (!best || score > best.score) {
        best = { y, right: rect.right, score, label };
      }
    }

    return best ? { y: best.y, right: best.right, label: best.label } : null;
  });

  const buttons = await waitForDayButtons(ctx, Math.min(4000, ctx.config.globalTimeout)).catch(() => []);
  const maxY = buttons.length > 0
    ? Math.max(...buttons.map((button) => button.y + button.height))
    : Math.round(viewport.height * 0.35);
  const baseY = headerInfo?.y ?? maxY + 24;
  const baseRight = headerInfo?.right ?? viewport.width - 80;

  const xPositions = [
    viewport.width - 28,
    viewport.width - 48,
    viewport.width - 68,
    Math.min(viewport.width - 20, baseRight + 24),
  ];
  const yPositions = [baseY + 10, baseY + 30, baseY - 6, baseY + 54];
  const candidates = xPositions.flatMap((x) => yPositions.map((y) => ({ x, y })));

  for (const candidate of candidates) {
    logger.debug(
      {
        x: Math.round(candidate.x),
        y: Math.round(candidate.y),
        headerLabel: headerInfo?.label,
        headerY: headerInfo?.y,
        headerRight: headerInfo?.right,
        viewport: { width: viewport.width, height: viewport.height },
        maxY,
        baseY,
      },
      'Attempting filter icon click'
    );
    await page.mouse.click(candidate.x, candidate.y);
    await page.waitForTimeout(500);
    if (await hasClassFilterPanel(ctx)) {
      return true;
    }
  }

  return false;
}

async function closeClassFilterPanel(ctx: FlowContext): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;

  const showResults = await tryClickByLabel(ctx, /show\s+\d+\s+results/i, 'Show results')
    || await tryClickByLabel(ctx, /show\s+results/i, 'Show results');
  if (showResults) {
    await page.waitForTimeout(500);
    return true;
  }

  const closedByLabel = await tryClickByLabel(ctx, /close/i, 'Close filter')
    || await tryClickByLabel(ctx, /^x$/i, 'Close filter');
  if (closedByLabel) {
    await page.waitForTimeout(500);
    return true;
  }

  const headerPos = await page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return null as null | { y: number };
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      if (label.toLowerCase().includes('class filter')) {
        const rect = el.getBoundingClientRect();
        if (!rect || rect.height < 12) {
          continue;
        }
        return { y: rect.top + rect.height / 2 };
      }
    }

    return null;
  });

  const viewport = page.viewportSize();
  if (viewport && headerPos) {
    const x = viewport.width - 24;
    const y = headerPos.y;
    logger.debug({ x: Math.round(x), y: Math.round(y) }, 'Attempting close filter icon click');
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    if (!(await hasClassFilterPanel(ctx))) {
      return true;
    }
  }

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
  return !(await hasClassFilterPanel(ctx));
}

async function applyClassFilter(ctx: FlowContext, classFilter: string): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const value = classFilter?.trim();
  if (!value) {
    return false;
  }

  const opened = await tryClickByLabel(ctx, /class filter/i, 'Class filter')
    || await tryClickByLabel(ctx, /filter/i, 'Filter')
    || await clickFilterIcon(ctx);
  if (!opened) {
    logger.debug({ classFilter: value }, 'Class filter control not found; skipping');
    return false;
  }

  await page.waitForTimeout(400);

  const escaped = escapeRegExp(value);
  const patterns = [
    new RegExp(`^\\s*${escaped}\\s*$`, 'i'),
    new RegExp(`\\b${escaped}\\b`, 'i'),
    new RegExp(escaped, 'i'),
  ];

  let selected = false;
  for (const pattern of patterns) {
    if (await tryClickByLabel(ctx, pattern, `Class type ${value}`)) {
      selected = true;
      break;
    }
  }

  if (!selected) {
    logger.warn({ classFilter: value }, 'Class filter option not found');
  }

  await page.waitForTimeout(300);
  const closed = await closeClassFilterPanel(ctx);
  if (!closed) {
    logger.warn('Class filter panel did not close');
  }
  await page.waitForTimeout(400);
  return selected;
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
      if (!rect || rect.width < 16 || rect.height < 16) {
        continue;
      }

      if (rect.y > window.innerHeight * 0.6) {
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
      if (lastCluster && Math.abs(candidate.y - lastCluster[0].y) < 30) {
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
    if (buttons.length >= DAY_ORDER.length) {
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

async function clickDayByKey(ctx: FlowContext, dayKey: DayKey): Promise<boolean> {
  let buttons = await waitForDayButtons(ctx, Math.min(8000, ctx.config.globalTimeout));
  if (buttons.length < DAY_ORDER.length) {
    await ctx.page!.mouse.wheel(0, -2000);
    await ctx.page!.waitForTimeout(400);
    await ctx.page!.keyboard.press('Home').catch(() => undefined);
    await ctx.page!.waitForTimeout(400);
    await enableFlutterSemantics(ctx);
    buttons = await waitForDayButtons(ctx, Math.min(8000, ctx.config.globalTimeout));
  }

  if (buttons.length < DAY_ORDER.length) {
    await dumpSemanticsLabels(ctx);
    ctx.logger.warn({ dayKey, buttons: buttons.length }, 'Day buttons not found; skipping day');
    return false;
  }

  const index = DAY_ORDER.indexOf(dayKey);
  const button = buttons[index];
  const x = button.x + button.width / 2;
  const y = button.y + button.height / 2;
  ctx.logger.debug({ dayKey, x: Math.round(x), y: Math.round(y), label: button.label }, 'Clicking day button');
  await ctx.page!.mouse.click(x, y);
  return true;
}

async function clickNextWeekToggle(ctx: FlowContext): Promise<boolean> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const buttons = await waitForDayButtons(ctx, Math.min(8000, ctx.config.globalTimeout)).catch(() => []);
  const maxY = buttons.length > 0
    ? Math.max(...buttons.map((button) => button.y + button.height))
    : null;

  if (buttons.length > 0) {
    const wedIndex = DAY_ORDER.indexOf('wed');
    const anchor = buttons[wedIndex] ?? buttons[Math.floor(buttons.length / 2)];
    const x = anchor.x + anchor.width / 2;
    const y = maxY ? maxY + 24 : anchor.y + anchor.height + 24;
    logger.debug({ x: Math.round(x), y: Math.round(y) }, 'Clicking next-week toggle');
    await page.mouse.click(x, y);
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

function formatDateCandidates(date: Date): RegExp[] {
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const month = monthNames[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return [
    new RegExp(`${month}.*\\b${day}\\b.*${year}`, 'i'),
    new RegExp(`\\b${day}\\b.*${month}.*${year}`, 'i'),
    new RegExp(`${month}.*\\b${day}\\b`, 'i'),
  ];
}

async function selectDateInPicker(ctx: FlowContext, date: Date): Promise<boolean> {
  const page = ctx.page!;
  const patterns = formatDateCandidates(date);
  const found = await page.evaluate((regexSources) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return null as null | { x: number; y: number };
    }

    const regexes = regexSources.map((source) => new RegExp(source, 'i'));
    const nodes = root.querySelectorAll('[aria-label]');
    let best: { el: HTMLElement; score: number } | null = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      if (!label) {
        continue;
      }
      let score = 0;
      for (const regex of regexes) {
        if (regex.test(label)) {
          score += 1;
        }
      }
      if (score === 0) {
        continue;
      }
      if (!best || score > best.score) {
        best = { el, score };
      }
    }

    if (!best) {
      return null;
    }

    const rect = best.el.getBoundingClientRect();
    if (!rect || rect.width < 12 || rect.height < 12) {
      return null;
    }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, patterns.map((pattern) => pattern.source));

  if (!found) {
    return false;
  }

  await page.mouse.click(found.x, found.y);
  await page.waitForTimeout(800);
  return true;
}

async function findTimeSlots(
  ctx: FlowContext,
  timeLabel: string
): Promise<SlotMatch[]> {
  const page = ctx.page!;
  const wanted = normalizeTimeLabel(timeLabel);

  const fromSemantics = await page.evaluate((timeText) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [];
    }

    const nodes = root.querySelectorAll('[aria-label]');
    const results: SlotMatch[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      const normalized = label.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
      if (!normalized.includes(timeText)) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 40 || rect.height < 18) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        continue;
      }

      results.push({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        label,
      });
    }

    results.sort((a, b) => a.y - b.y);
    return results;
  }, wanted);

  if (fromSemantics.length > 0) {
    return fromSemantics;
  }

  // Fallback: use text locators (some builds don’t expose time in aria-label).
  const matches: SlotMatch[] = [];
  const timeRegex = new RegExp(escapeRegExp(timeLabel).replace(/\s+/g, '\\s*'), 'i');
  const candidates = [
    page.getByText(timeRegex),
    page.locator('flt-semantics-host').getByText(timeRegex),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const handle = await locator.nth(i).elementHandle().catch(() => null);
      if (!handle) {
        continue;
      }
      const box = await handle.boundingBox();
      if (!box || box.width < 40 || box.height < 18) {
        continue;
      }
      if (box.y + box.height < 0 || box.y > (page.viewportSize()?.height ?? 0)) {
        continue;
      }
      matches.push({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        label: timeLabel,
      });
    }
  }

  matches.sort((a, b) => a.y - b.y);
  return matches;
}

async function hasClassLabel(ctx: FlowContext, classFilter: string): Promise<boolean> {
  const page = ctx.page!;
  const wanted = classFilter.trim().toLowerCase();
  return page.evaluate((filterText) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = el.getAttribute('aria-label') ?? '';
      if (label.toLowerCase().includes(filterText)) {
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 10 || rect.height < 10) {
          continue;
        }
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          continue;
        }
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }
        return true;
      }
    }

    return false;
  }, wanted);
}

async function hasTimeLabel(ctx: FlowContext, timeLabel: string): Promise<boolean> {
  const page = ctx.page!;
  const wanted = normalizeTimeLabel(timeLabel);
  return page.evaluate((filterText) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      const normalized = label.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
      if (normalized.includes(filterText)) {
        return true;
      }
    }

    return false;
  }, wanted);
}

async function findClassLabels(ctx: FlowContext, classFilter: string): Promise<LabelMatch[]> {
  const page = ctx.page!;
  const wanted = classFilter.trim().toLowerCase();
  const fromSemantics = await page.evaluate((filterText) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return [];
    }

    const nodes = root.querySelectorAll('[aria-label]');
    const results: LabelMatch[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      if (!label.toLowerCase().includes(filterText)) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 40 || rect.height < 18) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        continue;
      }

      results.push({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        label,
      });
    }

    results.sort((a, b) => a.y - b.y);
    return results;
  }, wanted);

  if (fromSemantics.length > 0) {
    return fromSemantics;
  }

  const matches: LabelMatch[] = [];
  const classRegex = new RegExp(escapeRegExp(classFilter), 'i');
  const candidates = [
    page.getByText(classRegex),
    page.locator('flt-semantics-host').getByText(classRegex),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const handle = await locator.nth(i).elementHandle().catch(() => null);
      if (!handle) {
        continue;
      }
      const box = await handle.boundingBox();
      if (!box || box.width < 40 || box.height < 18) {
        continue;
      }
      if (box.y + box.height < 0 || box.y > (page.viewportSize()?.height ?? 0)) {
        continue;
      }
      matches.push({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        label: classFilter,
      });
    }
  }

  matches.sort((a, b) => a.y - b.y);
  return matches;
}

function attachClassLabelsToSlots(
  slots: SlotMatch[],
  classLabels: LabelMatch[]
): SlotMatch[] {
  if (slots.length === 0 || classLabels.length === 0) {
    return [];
  }

  const centers = slots
    .map((slot) => slot.y + slot.height / 2)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i += 1) {
    const diff = centers[i] - centers[i - 1];
    if (diff > 1) {
      gaps.push(diff);
    }
  }
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 80;
  const maxDistance = Math.max(60, Math.min(140, Math.round(minGap * 0.75)));

  const matched: SlotMatch[] = [];
  for (const slot of slots) {
    const slotCenter = slot.y + slot.height / 2;
    let best: { label: LabelMatch; distance: number } | null = null;
    for (const label of classLabels) {
      const labelCenter = label.y + label.height / 2;
      const distance = Math.abs(labelCenter - slotCenter);
      if (!best || distance < best.distance) {
        best = { label, distance };
      }
    }
    if (best && best.distance <= maxDistance) {
      slot.classLabel = best.label;
      matched.push(slot);
    }
  }

  return matched;
}

async function hasBookingAction(ctx: FlowContext): Promise<boolean> {
  const page = ctx.page!;
  const labels = ['reserve', 'book', 'sign up', 'join', 'register', 'waitlist'];
  return page.evaluate((values) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      const normalized = label.toLowerCase();
      if (values.some((value) => normalized.includes(value))) {
        return true;
      }
    }

    return false;
  }, labels);
}

async function hasVisibleText(ctx: FlowContext, pattern: RegExp): Promise<boolean> {
  const page = ctx.page!;
  const locators = [
    page.getByText(pattern),
    page.locator('flt-semantics-host').getByText(pattern),
  ];

  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const handle = await locator.nth(i).elementHandle().catch(() => null);
      if (!handle) {
        continue;
      }
      const box = await handle.boundingBox();
      if (!box || box.width < 4 || box.height < 4) {
        continue;
      }
      const viewport = page.viewportSize();
      if (viewport && (box.y + box.height < 0 || box.y > viewport.height)) {
        continue;
      }
      return true;
    }
  }

  return false;
}

async function isReservedSlotInList(ctx: FlowContext, slot: SlotMatch): Promise<boolean> {
  const page = ctx.page!;
  return page.evaluate(({ slotRect }) => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return false;
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase();
      if (!label.includes('reserved')) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 24 || rect.height < 16) {
        continue;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        continue;
      }

      const slotTop = slotRect.y - 24;
      const slotBottom = slotRect.y + slotRect.height + 120;
      const withinY = rect.bottom >= slotTop && rect.top <= slotBottom;
      const toRight = rect.left >= slotRect.x + 120;
      if (withinY && toRight) {
        return true;
      }
    }

    return false;
  }, {
    slotRect: {
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
    },
  });
}

async function detectBookingOutcome(ctx: FlowContext): Promise<BookingRecord['status']> {
  const page = ctx.page!;
  const fromSemantics = await page.evaluate(() => {
    const host = document.querySelector('flt-semantics-host');
    const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
      ? (host as HTMLElement).shadowRoot
      : host;
    if (!root) {
      return 'unknown';
    }

    const nodes = root.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i += 1) {
      const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
      const normalized = label.toLowerCase();
      if (normalized.includes('reserved')) {
        return 'reserved';
      }
      if (
        normalized.includes('registered')
        || normalized.includes('booked')
        || normalized.includes('enrolled')
        || normalized.includes('attending')
        || normalized.includes('checked in')
        || normalized.includes('check in')
        || normalized.includes('check-in')
      ) {
        return 'reserved';
      }
      if (normalized.includes('waitlist')) {
        return 'waitlisted';
      }
      if (
        normalized.includes('cancel reservation')
        || normalized.includes('cancel booking')
        || normalized.includes('cancel class')
        || normalized.includes('leave waitlist')
        || normalized.includes('cancel waitlist')
        || normalized.includes('withdraw')
      ) {
        return normalized.includes('waitlist') ? 'waitlisted' : 'reserved';
      }
      if (normalized.includes('unavailable') || normalized.includes('class full')) {
        return 'unavailable';
      }
    }

    return 'unknown';
  }) as BookingRecord['status'];

  if (fromSemantics !== 'unknown') {
    return fromSemantics;
  }

  if (await hasVisibleText(ctx, /check\s*-?\s*in/i)) {
    return 'reserved';
  }
  if (await hasVisibleText(ctx, /cancel\s+(reservation|booking|class)/i)) {
    return 'reserved';
  }
  if (await hasVisibleText(ctx, /waitlist/i)) {
    return 'waitlisted';
  }

  return 'unknown';
}

async function openSlotDetails(
  ctx: FlowContext,
  slot: SlotMatch,
  classFilter?: string
): Promise<import('playwright').Page> {
  let page = ctx.page!;
  const basePage = page;
  const centerX = slot.x + slot.width / 2;
  const centerY = slot.y + slot.height / 2;
  const logger = ctx.logger;
  const viewport = page.viewportSize();

  const clickWithPopup = async (x: number, y: number, label: string): Promise<void> => {
    const popupPromise = page.waitForEvent('popup', { timeout: 1000 }).catch(() => null);
    await page.mouse.click(x, y);
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
      ctx.page = popup;
      page = popup;
      logger.debug({ selector: label }, 'Popup opened; switching to popup page');
      await enableFlutterSemantics(ctx);
    }
  };

  if (slot.classLabel) {
    const label = slot.classLabel;
    const viewHeight = page.viewportSize()?.height ?? 0;
    const labelCenterY = label.y + label.height / 2;
    if (labelCenterY >= 0 && (viewHeight === 0 || labelCenterY <= viewHeight)) {
      logger.debug(
        { selector: 'class-label', x: Math.round(label.x), y: Math.round(label.y) },
        'Clicking matched class label'
      );
      await clickWithPopup(label.x + label.width / 2, label.y + label.height / 2, 'class-label');
      await page.waitForTimeout(600);
      if (await hasBookingAction(ctx)) {
        return page;
      }
    } else {
      logger.debug(
        { selector: 'class-label', x: Math.round(label.x), y: Math.round(label.y) },
        'Matched class label offscreen; skipping'
      );
    }
  }

  if (classFilter && !slot.classLabel) {
    const matches = await findClassLabels(ctx, classFilter);
    if (matches.length > 0) {
      const nearest = matches.reduce((best, current) => {
        const bestDist = Math.abs(best.y - slot.y);
        const currentDist = Math.abs(current.y - slot.y);
        return currentDist < bestDist ? current : best;
      });
      if (Math.abs(nearest.y - slot.y) <= 40) {
        logger.debug(
          { selector: 'class-label', x: Math.round(nearest.x), y: Math.round(nearest.y) },
          'Clicking class label'
        );
        await clickWithPopup(nearest.x + nearest.width / 2, nearest.y + nearest.height / 2, 'class-label');
        await page.waitForTimeout(600);
        if (await hasBookingAction(ctx)) {
          return page;
        }
      }
    }
  }

  const attempts = [
    { name: 'time-label', x: centerX, y: centerY },
    { name: 'card-body', x: centerX + Math.max(160, slot.width * 2), y: centerY + 24 },
    { name: 'card-body-lower', x: centerX + Math.max(160, slot.width * 2), y: centerY + 64 },
  ];

  if (viewport) {
    attempts.push({ name: 'card-center', x: viewport.width * 0.6, y: centerY + 24 });
  }

  for (const attempt of attempts) {
    logger.debug({ selector: attempt.name, x: Math.round(attempt.x), y: Math.round(attempt.y) }, 'Clicking slot');
    await clickWithPopup(attempt.x, attempt.y, attempt.name);
    await page.waitForTimeout(500);
    if (await hasBookingAction(ctx)) {
      return page;
    }
  }

  return basePage;
}

async function waitForTimeSlots(ctx: FlowContext, timeLabel: string, timeoutMs: number): Promise<SlotMatch[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const slots = await findTimeSlots(ctx, timeLabel);
    if (slots.length > 0) {
      return slots;
    }
    await ctx.page!.waitForTimeout(300);
  }
  return [];
}

async function findTimeSlotsWithScroll(ctx: FlowContext, timeLabel: string): Promise<SlotMatch[]> {
  const page = ctx.page!;
  const maxScrolls = 12;
  const scrollStep = 600;

  let slots = await findTimeSlots(ctx, timeLabel);
  if (slots.length > 0) {
    return slots;
  }

  for (let i = 0; i < maxScrolls; i += 1) {
    await page.mouse.wheel(0, scrollStep);
    await page.waitForTimeout(500);
    slots = await findTimeSlots(ctx, timeLabel);
    if (slots.length > 0) {
      return slots;
    }
  }

  return [];
}

async function clickBookingAction(ctx: FlowContext): Promise<void> {
  const page = ctx.page!;
  const logger = ctx.logger;
  const config = ctx.config;

  const labels = [/reserve/i, /book/i, /sign up/i, /join/i, /register/i];
  const perAttemptTimeout = Math.min(2000, config.globalTimeout);

  for (const label of labels) {
    const attempts = [
      { name: 'role-button', locator: page.getByRole('button', { name: label }) },
      { name: 'text', locator: page.getByText(label) },
      { name: 'semantics-text', locator: page.locator('flt-semantics-host').getByText(label) },
    ];

    for (const attempt of attempts) {
      try {
        logger.debug({ selector: attempt.name, label: label.source }, 'Attempting to click booking action');
        const handle = await attempt.locator.first().elementHandle({ timeout: perAttemptTimeout }).catch(() => null);
        if (handle) {
          const box = await handle.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            logger.debug({ selector: attempt.name, label: label.source }, 'Clicked booking action');
            return;
          }
        }
      } catch {
        // continue
      }
    }
  }

  throw new Error('Booking action button not found.');
}

async function closeDetails(ctx: FlowContext): Promise<void> {
  const page = ctx.page!;
  const labels = [/back/i, /close/i, /^x$/i, /cancel/i];

  for (const label of labels) {
    try {
      const locator = page.getByRole('button', { name: label });
      const handle = await locator.first().elementHandle({ timeout: 500 }).catch(() => null);
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          return;
        }
      }
    } catch {
      // continue
    }
  }

  const fallbackPoints = [
    { x: 24, y: 120 },
    { x: 28, y: 88 },
    { x: 36, y: 132 },
  ];

  for (const point of fallbackPoints) {
    await page.mouse.click(point.x, point.y);
    const buttons = await waitForDayButtons(ctx, 1500).catch(() => []);
    if (buttons.length >= DAY_ORDER.length) {
      return;
    }
  }

  await page.keyboard.press('Escape').catch(() => undefined);
}

export const scheduleBookFlow: FlowDefinition = {
  name: 'schedule-book',
  description: 'Book CrossFit sessions on specified days and time',
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
      name: 'open-schedule',
      description: 'Open the Schedule tab in the bottom navigation.',
      action: async (ctx) => {
        await clickByLabel(ctx, SCHEDULE_LABEL, 'Schedule');
        await ctx.page!.waitForTimeout(1500);
      },
    },
    {
      name: 'open-category',
      description: 'Select the desired category at the top (Classes/Appointments/Events/Reservations).',
      action: async (ctx) => {
        const category = ctx.params?.category?.trim() || 'Classes';
        await clickByLabel(ctx, new RegExp(category, 'i'), category);
        await ctx.page!.waitForTimeout(1000);
      },
    },
    {
      name: 'apply-class-filter',
      description: 'Apply a class type filter if available (e.g., CrossFit).',
      action: async (ctx) => {
        const classParam = ctx.params?.class ?? 'CrossFit';
        await applyClassFilter(ctx, classParam);
      },
    },
    {
      name: 'maybe-open-next-week',
      description: 'Optionally open the next week selector when requested.',
      action: async (ctx) => {
        const offset = parseWeekOffset(ctx.params?.week);
        if (offset <= 0) {
          return;
        }

        const now = new Date();
        const target = new Date(now.getTime() + offset * 7 * 24 * 60 * 60 * 1000);
        const opened = await clickNextWeekToggle(ctx);
        if (!opened) {
          ctx.logger.debug('Next-week toggle not found; stopping week advance');
          return;
        }

        const selected = await selectDateInPicker(ctx, target);
        if (!selected) {
          ctx.logger.debug(
            { target: target.toDateString() },
            'Could not select target date in picker; continuing on current week'
          );
          return;
        }

        await waitForDayButtons(ctx, Math.min(8000, ctx.config.globalTimeout));
      },
    },
    {
      name: 'book-days',
      description: 'Book sessions for the specified days/time.',
      action: async (ctx) => {
        const daysParam = ctx.params?.days;
        const timeParam = ctx.params?.time;
        const classParam = ctx.params?.class ?? 'CrossFit';
        const confirm = ctx.params?.confirm === 'true';

        if (!daysParam || !timeParam) {
          throw new Error('Missing --days or --time parameter.');
        }

        const days = parseDays(daysParam);
        if (days.length === 0) {
          throw new Error('No valid days found in --days.');
        }

        if (!ctx.flowData) {
          ctx.flowData = {};
        }
        if (!ctx.flowData.matches) {
          ctx.flowData.matches = [];
        }
        if (!ctx.flowData.bookings) {
          ctx.flowData.bookings = [];
        }
        if (!ctx.flowData.attempts) {
          ctx.flowData.attempts = [];
        }

        for (const day of days) {
          const clicked = await clickDayByKey(ctx, day);
          if (!clicked) {
            ctx.logger.warn({ day }, 'Day buttons missing; stopping schedule booking');
            ctx.flowData.notice = {
              reason: 'day-buttons-missing',
              day,
              time: timeParam,
            };
            return;
          }
          await ctx.page!.waitForTimeout(1000);

          let slots = await waitForTimeSlots(ctx, timeParam, 6000);
          if (slots.length === 0) {
            slots = await findTimeSlotsWithScroll(ctx, timeParam);
          }
          if (slots.length === 0) {
            const visibleTimes = await listVisibleTimes(ctx);
            ctx.logger.info({ day, time: timeParam, visibleTimes }, 'No slots matched time');
            continue;
          }

          let slotsToUse = slots;
          if (classParam) {
            const classLabels = await findClassLabels(ctx, classParam);
            const matchedByLabel = classLabels.length > 0 ? attachClassLabelsToSlots(slots, classLabels) : [];
            const matchedByProximity = matchedByLabel.length > 0
              ? []
              : await filterSlotsByClassLabel(ctx, slots, classParam);

            if (matchedByLabel.length > 0) {
              slotsToUse = matchedByLabel;
            } else if (matchedByProximity.length > 0) {
              slotsToUse = matchedByProximity;
            } else if (slots.length > 1) {
              ctx.logger.info(
                { day, time: timeParam, classParam, slots: slots.length },
                'Multiple slots found but none matched class label; skipping time'
              );
              continue;
            } else {
              ctx.logger.debug(
                { day, time: timeParam, classParam },
                'No class labels matched; using single time match'
              );
            }
          }

            ctx.logger.debug({ day, time: timeParam, slots: slotsToUse.length }, 'Matched slots');

          for (const slot of slotsToUse) {
            const allowWaitlist = ctx.params?.waitlist === 'true';

            const listReserved = await isReservedSlotInList(ctx, slot);
            if (listReserved) {
              ctx.logger.info({ day, time: timeParam, label: slot.label }, 'Slot already reserved in list; skipping');
              (ctx.flowData.bookings as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'reserved',
                note: 'already-reserved-list',
              });
              continue;
            }

            if (labelHasReserveSoon(slot.label)) {
              ctx.logger.info({ day, label: slot.label }, 'Reserve-soon slot detected; stopping flow');
              (ctx.flowData.attempts as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'skipped',
                note: 'reserve-soon',
              });
              ctx.flowData.notice = {
                reason: 'reserve-soon',
                day,
                time: timeParam,
                label: slot.label,
              };
              return;
            }

            if (!confirm) {
              (ctx.flowData.matches as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'attempted',
              });
              ctx.logger.info({ day, time: timeParam, label: slot.label }, 'Dry-run match');
              continue;
            }

            const basePage = ctx.page!;
            const detailPage = await openSlotDetails(ctx, slot, classParam);

            const hasTime = await hasTimeLabel(ctx, timeParam);
            if (!hasTime) {
              ctx.logger.debug({ day, label: slot.label, time: timeParam }, 'Time label not found in details; skipping');
              await closeDetails(ctx);
              (ctx.flowData.attempts as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'skipped',
                note: 'time-mismatch',
              });
              if (detailPage !== basePage) {
                await detailPage.close().catch(() => undefined);
                ctx.page = basePage;
                await basePage.bringToFront().catch(() => undefined);
                await basePage.waitForTimeout(300);
              }
              continue;
            }

            if (classParam) {
              const hasClass = await hasClassLabel(ctx, classParam);
              if (!hasClass) {
                ctx.logger.debug({ day, label: slot.label }, 'Class label not found in details; skipping');
                await closeDetails(ctx);
                (ctx.flowData.attempts as BookingRecord[]).push({
                  day,
                  time: timeParam,
                  className: classParam,
                  label: slot.label,
                  status: 'skipped',
                  note: 'class-mismatch',
                });
                if (detailPage !== basePage) {
                  await detailPage.close().catch(() => undefined);
                  ctx.page = basePage;
                  await basePage.bringToFront().catch(() => undefined);
                  await basePage.waitForTimeout(300);
                }
                continue;
              }
            }

            const preOutcome = await detectBookingOutcome(ctx);
            if (preOutcome === 'reserved' || preOutcome === 'waitlisted') {
              (ctx.flowData.bookings as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: preOutcome,
                note: 'already-booked',
              });
              await closeDetails(ctx);
              if (detailPage !== basePage) {
                await detailPage.close().catch(() => undefined);
                ctx.page = basePage;
                await basePage.bringToFront().catch(() => undefined);
                await basePage.waitForTimeout(300);
              }
              continue;
            }

            const hasAction = await hasBookingAction(ctx);
            if (!hasAction) {
              ctx.logger.debug({ day, label: slot.label }, 'Booking action not available; skipping');
              await closeDetails(ctx);
              (ctx.flowData.attempts as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'unavailable',
                note: 'no-booking-action',
              });
              if (detailPage !== basePage) {
                await detailPage.close().catch(() => undefined);
                ctx.page = basePage;
                await basePage.bringToFront().catch(() => undefined);
                await basePage.waitForTimeout(300);
              }
              continue;
            }

            if (!allowWaitlist) {
              const waitlistOnly = await ctx.page!.evaluate(() => {
                const host = document.querySelector('flt-semantics-host');
                const root = host && 'shadowRoot' in host && (host as HTMLElement).shadowRoot
                  ? (host as HTMLElement).shadowRoot
                  : host;
                if (!root) {
                  return false;
                }

                const nodes = root.querySelectorAll('[aria-label]');
                for (let i = 0; i < nodes.length; i += 1) {
                  const label = (nodes[i] as HTMLElement).getAttribute('aria-label') ?? '';
                  const normalized = label.toLowerCase();
                  if (normalized.includes('class full') || normalized.includes('waitlist')) {
                    return true;
                  }
                }
                return false;
              });
              if (waitlistOnly) {
                ctx.logger.info({ day, label: slot.label }, 'Skipping waitlist-only slot');
                await closeDetails(ctx);
                (ctx.flowData.attempts as BookingRecord[]).push({
                  day,
                  time: timeParam,
                  className: classParam,
                  label: slot.label,
                  status: 'skipped',
                  note: 'waitlist-only',
                });
                if (detailPage !== basePage) {
                  await detailPage.close().catch(() => undefined);
                  ctx.page = basePage;
                  await basePage.bringToFront().catch(() => undefined);
                  await basePage.waitForTimeout(300);
                }
                continue;
              }
            }

            await clickBookingAction(ctx);
            await ctx.page!.waitForTimeout(1200);
            const outcome = await detectBookingOutcome(ctx);
            if (outcome === 'reserved' || outcome === 'waitlisted') {
              (ctx.flowData.bookings as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: outcome,
              });
            } else {
              (ctx.flowData.attempts as BookingRecord[]).push({
                day,
                time: timeParam,
                className: classParam,
                label: slot.label,
                status: 'attempted',
                note: outcome,
              });
            }
            await closeDetails(ctx);
            if (detailPage !== basePage) {
              await detailPage.close().catch(() => undefined);
              ctx.page = basePage;
              await basePage.bringToFront().catch(() => undefined);
              await basePage.waitForTimeout(300);
            }
            await ctx.page!.waitForTimeout(300);
          }
        }
      },
    },
  ],
};
