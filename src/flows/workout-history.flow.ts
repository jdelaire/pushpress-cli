import { FlowDefinition } from '../types';

const WORKOUTS_LABEL = /workouts/i;

async function clickWorkouts(ctx: any): Promise<void> {
  const page = ctx.page;
  const logger = ctx.logger;
  const config = ctx.config;

  const attempts = [
    { name: 'role-button', locator: page.getByRole('button', { name: WORKOUTS_LABEL }) },
    { name: 'role-link', locator: page.getByRole('link', { name: WORKOUTS_LABEL }) },
    { name: 'text', locator: page.getByText(WORKOUTS_LABEL) },
    { name: 'semantics-text', locator: page.locator('flt-semantics-host').getByText(WORKOUTS_LABEL) },
  ];

  const perAttemptTimeout = Math.min(2000, config.globalTimeout);

  for (const attempt of attempts) {
    try {
      logger.debug({ selector: attempt.name }, 'Attempting to click Workouts');
      const handle = await attempt.locator.first().elementHandle({ timeout: perAttemptTimeout }).catch(() => null);
      if (handle) {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          logger.debug({ selector: attempt.name }, 'Clicked Workouts');
          return;
        }
      }
    } catch {
      // continue
    }
  }

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const fallbackX = Math.round(viewport.width * 0.75);
  const fallbackY = Math.round(viewport.height - 30);
  logger.debug(
    { x: fallbackX, y: fallbackY, width: viewport.width, height: viewport.height },
    'Falling back to coordinate click for Workouts'
  );
  await page.mouse.click(fallbackX, fallbackY);
}

export const workoutHistoryFlow: FlowDefinition = {
  name: 'workout-history',
  description: 'Navigate to workouts and capture workout data',
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
      name: 'open-workouts',
      description: 'Open the Workouts tab in the bottom navigation.',
      action: async (ctx) => {
        await clickWorkouts(ctx);
        await ctx.page!.waitForTimeout(1000);
      },
    },
    {
      name: 'capture-workouts',
      description: 'Capture JSON responses after opening Workouts.',
      captureRules: [
        { name: 'workouts', urlPattern: 'workout' },
        { name: 'workout-history', urlPattern: 'history' },
        { name: 'workout-json', urlPattern: '*' },
      ],
      action: async (ctx) => {
        await ctx.page!.waitForTimeout(5000);
      },
    },
  ],
};
