import { Command } from 'commander';
import { flows, getFlow } from './flows';
import { loadConfig, redactConfig, validateConfig } from './config';
import { createLogger } from './logger';
import { launchBrowser } from './browser';
import { AppConfig, FlowContext } from './types';
import { sessionStateExists, validateSession } from './auth';
import { runFlow } from './flow-runner';
import { NetworkCapture } from './capture';
import { writeOutput, writeOutputWithSuffix, writeTextOutputWithSuffix } from './output';
import { buildWorkoutSummaryByDay } from './summary';
import { generateWorkoutWeekMarkdown } from './openai';

function parseCliNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyRunOverrides(
  config: AppConfig,
  options: {
    headless?: boolean;
    slowMo?: string;
    timeout?: string;
  }
): AppConfig {
  const next = { ...config };

  if (options.headless !== undefined) {
    next.headless = options.headless;
  }

  if (options.slowMo !== undefined) {
    next.slowMo = parseCliNumber(options.slowMo, config.slowMo);
  }

  if (options.timeout !== undefined) {
    next.globalTimeout = parseCliNumber(options.timeout, config.globalTimeout);
  }

  return next;
}

function isMissingBrowserError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('executable doesn') || message.includes('playwright install');
}

async function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY) {
    return;
  }

  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

const program = new Command();

program
  .name('cfcnx')
  .description('PushPress client CLI for member workflows')
  .version('0.1.0')
  .option('--config <path>', 'Path to config file', '.env')
  .option('--verbose', 'Enable debug logging');

program
  .command('list')
  .description('List available flows')
  .action(() => {
    const { config: configPath, verbose } = program.opts<{
      config: string;
      verbose?: boolean;
    }>();
    const config = loadConfig({ path: configPath });
    const logger = createLogger(config, { level: verbose ? 'debug' : undefined });

    logger.debug({ flowCount: flows.length }, 'Listing flows');

    if (flows.length === 0) {
      console.log('No flows registered.');
      return;
    }

    console.log('Available flows:');
    for (const flow of flows) {
      console.log(`- ${flow.name}: ${flow.description}`);
    }
  });

program
  .command('config')
  .description('Show resolved configuration (redacted)')
  .option('--validate', 'Validate required config values')
  .action((options) => {
    const { config: configPath, verbose } = program.opts<{
      config: string;
      verbose?: boolean;
    }>();
    const config = loadConfig({ path: configPath });
    const logger = createLogger(config, { level: verbose ? 'debug' : undefined });
    const errors = validateConfig(config);

    logger.debug({ errorCount: errors.length }, 'Config validation complete');

    if (options.validate) {
      if (errors.length > 0) {
        console.error('Config errors:');
        for (const error of errors) {
          console.error(`- ${error.field}: ${error.message}`);
        }
        process.exitCode = 1;
      } else {
        console.log('Config is valid.');
      }
    }

    console.log(JSON.stringify(redactConfig(config), null, 2));
  });

program
  .command('validate-session')
  .description('Check if the saved session is still valid')
  .action(async () => {
    const { config: configPath, verbose } = program.opts<{
      config: string;
      verbose?: boolean;
    }>();
    const config = loadConfig({ path: configPath });
    const logger = createLogger(config, { level: verbose ? 'debug' : undefined });

    if (!sessionStateExists(config)) {
      logger.info('No session state file found.');
      process.exitCode = 1;
      return;
    }

    try {
      const session = await launchBrowser(config);
      try {
        const valid = await validateSession(session.page, config, logger);
        if (valid) {
          console.log('Session is valid.');
        } else {
          console.log('Session is invalid.');
          process.exitCode = 1;
        }
      } finally {
        await session.close();
      }
    } catch (error) {
      if (isMissingBrowserError(error)) {
        logger.error('Playwright browsers are missing. Run: npx playwright install');
      } else {
        logger.error({ err: error }, 'Session validation failed');
      }
      process.exitCode = 1;
    }
  });

program
  .command('run')
  .description('Execute a named flow')
  .argument('<flow>', 'Flow name')
  .option('--headless', 'Run in headless mode (default: true)')
  .option('--no-headless', 'Run with visible browser')
  .option('--slow-mo <ms>', 'Slow down actions by N ms')
  .option('--timeout <ms>', 'Global timeout in ms')
  .option('--dry-run', 'Log actions without executing them')
  .option('--pause', 'Pause before closing the browser')
  .option('--days <list>', 'Comma-separated days for schedule booking (e.g., mon,wed,fri)')
  .option('--time <time>', 'Time label to match (e.g., \"5:00 PM\")')
  .option('--class <name>', 'Class name filter (default: CrossFit)')
  .option('--type <name>', 'Class type filter (alias for --class)')
  .option('--category <name>', 'Schedule category (Classes/Appointments/Events/Reservations)')
  .option('--week <which>', 'Schedule week to target (current/next/2/3...)')
  .option('--waitlist', 'Allow joining waitlists when class is full')
  .option('--confirm', 'Confirm and perform booking actions')
  .action(async (flowName, options) => {
    const { config: configPath, verbose } = program.opts<{
      config: string;
      verbose?: boolean;
    }>();
    const baseConfig = loadConfig({ path: configPath });
    const config = applyRunOverrides(baseConfig, options);
    const logger = createLogger(config, { level: verbose ? 'debug' : undefined });

    const flow = getFlow(flowName);
    if (!flow) {
      logger.error({ flow: flowName }, 'Unknown flow');
      console.error('Available flows:');
      for (const available of flows) {
        console.error(`- ${available.name}`);
      }
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) {
      const ctx: FlowContext = { config, logger };
      await runFlow(flow, ctx, { dryRun: true });
      return;
    }

    logger.info(
      { flow: flow.name, sessionStateExists: sessionStateExists(config) },
      'Launching browser'
    );

    try {
      const session = await launchBrowser(config);

      try {
        const capture = new NetworkCapture(session.page, logger);
        const params: Record<string, string | undefined> = {
          days: options.days,
          time: options.time,
          class: options.class ?? options.type,
          category: options.category,
          week: options.week,
          waitlist: options.waitlist ? 'true' : 'false',
          confirm: options.confirm ? 'true' : 'false',
        };
        const ctx: FlowContext = { config, logger, page: session.page, capture, params };

        if (flow.name !== 'login') {
          const hasSession = sessionStateExists(config);
          if (hasSession) {
            logger.info({ flow: flow.name }, 'Validating existing session');
            const valid = await validateSession(session.page, config, logger);
            if (!valid) {
              logger.info({ flow: 'login' }, 'Session invalid; re-authenticating');
              const loginFlow = getFlow('login');
              if (!loginFlow) {
                throw new Error('Login flow is not registered.');
              }
              await runFlow(loginFlow, ctx);
            }
          }
        }

        const start = Date.now();
        if (flow.name === 'schedule-book' && !options.confirm) {
          logger.info('Schedule booking is running in dry mode. Use --confirm to book.');
        }

        const result = await runFlow(flow, ctx);
        const durationMs = Date.now() - start;

        if (flow.name !== 'login') {
          const now = new Date();
          const envelope = {
            meta: {
              tool: 'cfcnx-pushpress-cli',
              version: '0.1.0',
              flow: flow.name,
              appUrl: config.baseUrl,
              timestamp: now.toISOString(),
              durationMs,
              stepsCompleted: result.stepsCompleted,
              stepsTotal: flow.steps.length,
              success: true,
            },
            data: result.data,
            errors: [],
          };

          const outputPath = writeOutputWithSuffix(config, flow.name, envelope, '', now);
          logger.info({ outputPath }, 'Output written');

          if (flow.name === 'workout-week') {
            const summarySource = {
              workoutsWeek: result.data['workouts-week'],
              workoutHistoryWeek: result.data['workout-history-week'],
              weekRaw: result.data['week-raw'],
            } as Record<string, unknown>;
            const summary = buildWorkoutSummaryByDay(summarySource);
            const summaryEnvelope = {
              meta: {
                ...envelope.meta,
                flow: `${flow.name}-summary`,
              },
              data: {
                summaryByDay: summary,
              },
              errors: [],
            };
            const summaryPath = writeOutputWithSuffix(
              config,
              flow.name,
              summaryEnvelope,
              '-summary',
              now
            );
            logger.info({ summaryPath }, 'Summary output written');

            try {
              const markdown = await generateWorkoutWeekMarkdown(
                config,
                summaryEnvelope,
                logger
              );
              const markdownPath = writeTextOutputWithSuffix(
                config,
                flow.name,
                markdown,
                '-summary',
                '.md',
                now
              );
              logger.info({ markdownPath }, 'Markdown summary written');
            } catch (error) {
              logger.warn({ err: error }, 'Markdown summary generation skipped');
            }
          }
        }

        if (options.pause) {
          logger.info('Flow complete. Press Enter to close the browser.');
          await waitForEnter();
        }
      } finally {
        await session.close();
        logger.info({ flow: flow.name }, 'Browser closed.');
      }
    } catch (error) {
      if (isMissingBrowserError(error)) {
        logger.error('Playwright browsers are missing. Run: npx playwright install');
      } else {
        logger.error({ err: error }, 'Run failed');
      }
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
