export interface WorkoutSummaryItem {
  title?: string;
  description?: string;
  workoutTitle?: string;
}

export interface WorkoutDaySummary {
  date?: string;
  items: WorkoutSummaryItem[];
}

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/\s+/g, ' ') : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function tryAddSummary(
  source: Record<string, unknown>,
  results: WorkoutSummaryItem[],
  seen: Set<string>
): void {
  const title = normalizeText(source.title);
  const description = normalizeText(source.description);
  const workoutTitle = normalizeText(source.workoutTitle);

  if (title && title.toLowerCase() === 'warm-up flow') {
    return;
  }

  if (!title && !description && !workoutTitle) {
    return;
  }

  const item: WorkoutSummaryItem = {};
  if (title) item.title = title;
  if (description) item.description = description;
  if (workoutTitle) item.workoutTitle = workoutTitle;

  const key = JSON.stringify(item);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  results.push(item);
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

function findDateInObject(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDateInObject(entry);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const preferredKeys = ['rawPublishingDate', 'createdDate', 'publishedOn', 'date'];
  for (const key of preferredKeys) {
    if (key in value) {
      const found = normalizeDate((value as Record<string, unknown>)[key]);
      if (found) {
        return found;
      }
    }
  }

  for (const entry of Object.values(value)) {
    const found = findDateInObject(entry);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function dayKeyFromDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return DAY_ORDER[parsed.getUTCDay()];
}

function collectWorkoutOfDay(value: unknown, results: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectWorkoutOfDay(entry, results);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  if ('workoutOfDay' in value && Array.isArray(value.workoutOfDay)) {
    for (const item of value.workoutOfDay) {
      if (isPlainObject(item)) {
        results.push(item);
      }
    }
  }

  for (const entry of Object.values(value)) {
    collectWorkoutOfDay(entry, results);
  }
}

function extractPayload(entry: unknown): { payload: unknown; fallbackDay?: string } | null {
  if (!isPlainObject(entry)) {
    return null;
  }
  if ('data' in entry) {
    const dataValue = (entry as Record<string, unknown>).data;
    let fallbackDay: string | undefined;
    if (isPlainObject(dataValue) && typeof dataValue.day === 'string') {
      fallbackDay = dataValue.day.toLowerCase();
    }
    if (isPlainObject(dataValue) && 'data' in dataValue) {
      return { payload: (dataValue as Record<string, unknown>).data, fallbackDay };
    }
    return { payload: dataValue, fallbackDay };
  }
  return { payload: entry };
}

export function buildWorkoutSummaryByDay(
  data: Record<string, unknown>
): Record<string, WorkoutDaySummary> {
  const summary: Record<string, WorkoutDaySummary> = {};
  const sources: unknown[] = [];

  if (Array.isArray(data.workoutsWeek)) {
    sources.push(...data.workoutsWeek);
  }
  if (Array.isArray(data.workoutHistoryWeek)) {
    sources.push(...data.workoutHistoryWeek);
  }
  if (Array.isArray(data.weekRaw)) {
    sources.push(...data.weekRaw);
  }

  for (const entry of sources) {
    const extracted = extractPayload(entry);
    if (!extracted) {
      continue;
    }
    const { payload, fallbackDay } = extracted;

    const workouts: Record<string, unknown>[] = [];
    collectWorkoutOfDay(payload, workouts);
    if (workouts.length === 0) {
      continue;
    }

    for (const workout of workouts) {
      const date = findDateInObject(workout);
      const dayKey = dayKeyFromDate(date) ?? fallbackDay;
      if (!dayKey) {
        continue;
      }
      if (!summary[dayKey]) {
        summary[dayKey] = { items: [] };
      }
      const bucket = summary[dayKey];
      if (!bucket.date && date) {
        bucket.date = date;
      }

      const seen = new Set<string>(bucket.items.map((item) => JSON.stringify(item)));

      if (workout.title) {
        tryAddSummary(workout, bucket.items, seen);
      }

      if (Array.isArray(workout.parts)) {
        for (const part of workout.parts) {
          if (isPlainObject(part)) {
            tryAddSummary(part, bucket.items, seen);
          }
        }
      }
    }
  }

  return summary;
}
