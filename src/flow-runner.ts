import { FlowContext, FlowDefinition } from './types';

export interface RunOptions {
  dryRun?: boolean;
}

export interface RunResult {
  data: Record<string, unknown>;
  stepsCompleted: number;
}

function mergeCapture(
  target: Record<string, unknown>,
  captured: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(captured)) {
    if (!target[key]) {
      target[key] = value;
      continue;
    }

    if (Array.isArray(target[key]) && Array.isArray(value)) {
      (target[key] as unknown[]).push(...value);
      continue;
    }

    target[key] = value;
  }
}

export async function runFlow(
  flow: FlowDefinition,
  ctx: FlowContext,
  options: RunOptions = {}
): Promise<RunResult> {
  const { dryRun = false } = options;
  const data: Record<string, unknown> = {};
  let stepsCompleted = 0;

  ctx.logger.info({ flow: flow.name, dryRun }, 'Starting flow');

  for (const step of flow.steps) {
    if (dryRun) {
      ctx.logger.info({ flow: flow.name, step: step.name }, 'Dry run step');
      if (step.description) {
        ctx.logger.info(
          { flow: flow.name, step: step.name },
          step.description
        );
      }
      stepsCompleted += 1;
      continue;
    }

    if (!ctx.page) {
      throw new Error('FlowContext.page is required for non-dry-run execution.');
    }

    ctx.logger.info({ flow: flow.name, step: step.name }, 'Running step');
    ctx.capture?.setRules(step.captureRules ?? []);
    await step.action(ctx);
    stepsCompleted += 1;

    if (ctx.capture) {
      const captured = ctx.capture.flush();
      mergeCapture(data, captured);
    }
  }

  ctx.logger.info({ flow: flow.name, dryRun }, 'Flow complete');
  if (ctx.flowData) {
    mergeCapture(data, ctx.flowData);
  }
  return { data, stepsCompleted };
}
