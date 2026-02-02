# Implementation Plan: PushPress Client CLI

> **Target user**: PushPress **client** (gym member), not the admin/owner.
> **Primary use cases**:
> 1. **Ease sign-in** — automate the member login flow.
> 2. **Extract workout data** — pull workout history, results, and performance metrics from the client-facing app.

---

## 1. Architecture Overview

### 1.1 System Diagram

```
┌─────────────────────────────────────────────────────┐
│                      CLI Layer                      │
│  (commander.js — parses commands, loads config)     │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   Flow Runner                        │
│  Orchestrates flows, manages retries, emits events  │
└──┬──────────────┬───────────────┬───────────────────┘
   │              │               │
┌──▼───┐   ┌─────▼─────┐   ┌────▼────────────┐
│ Auth │   │  Actions   │   │ Data Capture    │
│Module│   │  Library   │   │ (Network Intcpt)│
└──┬───┘   └─────┬─────┘   └────┬────────────┘
   │              │               │
┌──▼──────────────▼───────────────▼───────────────────┐
│              Playwright Browser Context              │
│  (storageState, tracing, request/response listeners) │
└─────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   Output Layer                       │
│  (JSON files, screenshots, traces, structured logs) │
└─────────────────────────────────────────────────────┘
```

### 1.2 Module Responsibilities

| Module | File(s) | Responsibility |
|---|---|---|
| **CLI** | `src/cli.ts` | Parse commands/options, load config, invoke flow runner |
| **Config** | `src/config.ts` | Merge env vars, `.env` file, CLI flags into typed config object |
| **Auth** | `src/auth.ts` | Login flow, session save/restore, expiry detection, re-auth |
| **Browser** | `src/browser.ts` | Playwright launch, context creation, tracing setup |
| **NetworkCapture** | `src/capture.ts` | Register response listeners, filter/buffer JSON responses |
| **Actions** | `src/actions.ts` | Reusable UI primitives (click, type, wait-for-network, wait-for-nav) |
| **FlowRunner** | `src/flow-runner.ts` | Execute a flow definition step-by-step, handle retries, emit lifecycle events |
| **Flows** | `src/flows/*.ts` | Individual flow definitions (one file per flow) |
| **Output** | `src/output.ts` | Write JSON results, metadata envelope, file naming |
| **Logger** | `src/logger.ts` | Structured logging (pino) with context |
| **Retry** | `src/retry.ts` | Generic retry-with-backoff wrapper |

---

## 2. Folder Structure

```
cfcnx-pushpress-cli/
├── docs/
│   └── plan.md                  # This file
├── src/
│   ├── cli.ts                   # CLI entry point
│   ├── config.ts                # Config loader
│   ├── auth.ts                  # Auth module
│   ├── browser.ts               # Playwright browser/context factory
│   ├── capture.ts               # Network response capture
│   ├── actions.ts               # UI action primitives
│   ├── flow-runner.ts           # Flow orchestrator
│   ├── flows/
│   │   ├── index.ts             # Flow registry (name -> flow definition)
│   │   ├── login.flow.ts        # Login flow (client/member auth)
│   │   ├── login.flow.ts        # Client login flow
│   │   └── workout-history.flow.ts  # Extract workout data for the logged-in member
│   ├── output.ts                # JSON output writer
│   ├── logger.ts                # Structured logger
│   ├── retry.ts                 # Retry utility
│   └── types.ts                 # Shared TypeScript types/interfaces
├── tests/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── capture.test.ts
│   │   ├── output.test.ts
│   │   └── retry.test.ts
│   ├── integration/
│   │   └── login.test.ts        # Real browser login smoke test
│   └── mocks/
│       └── responses/           # Saved JSON responses for unit tests
├── output/                      # Default output directory (gitignored)
├── artifacts/                   # Screenshots/traces on failure (gitignored)
├── .env.example                 # Template for required env vars
├── .gitignore
├── package.json
├── tsconfig.json
└── playwright.config.ts         # Optional: only if using Playwright Test runner for integration tests
```

---

## 3. Key Playwright Patterns

### 3.1 Storage State for Session Reuse

```typescript
// Save after successful login
await context.storageState({ path: SESSION_STATE_PATH });

// Restore on next run
const context = await browser.newContext({
  storageState: fs.existsSync(SESSION_STATE_PATH)
    ? SESSION_STATE_PATH
    : undefined,
});
```

- Store at `./state/session.json` (gitignored, treated as sensitive).
- On every run: attempt to restore session, navigate to a known authenticated page, check if redirected to login. If redirected, session is expired — re-login.

### 3.2 Request/Response Listeners

```typescript
// Register BEFORE navigating so we catch all responses
page.on('response', async (response) => {
  const url = response.url();
  if (matchesEndpoint(url, captureRules)) {
    const json = await response.json().catch(() => null);
    if (json) captureBuffer.push({ url, timestamp: Date.now(), data: json });
  }
});
```

- Listeners are registered once per page at context creation.
- `captureRules` is an array of `{ urlPattern: string | RegExp, name: string }` defined per flow.
- Buffer is flushed to disk at the end of each flow step.

### 3.3 Tracing

```typescript
await context.tracing.start({ screenshots: true, snapshots: true });

// On failure:
await context.tracing.stop({ path: `artifacts/trace-${flowName}-${ts}.zip` });

// On success (optional, controlled by config):
await context.tracing.stop({ path: undefined }); // discard
```

- Always start tracing; only persist to disk on failure (unless `--save-traces` flag is set).

### 3.4 Waiting Strategies (Flutter-Specific)

Flutter Web with HTML renderer has specific quirks:

- **Wait for network idle is unreliable** — Flutter may keep websocket/long-poll connections open.
- **Preferred approach**: Wait for a specific network response that signals data has loaded.
- **Fallback**: Wait for a known semantics element in `flt-semantics-host` shadow DOM.
- **Last resort**: Fixed timeout with polling for a visual indicator.

```typescript
// Primary: wait for the API response that signals the data is loaded
const response = await page.waitForResponse(
  (resp) => resp.url().includes('/api/target-endpoint') && resp.status() === 200,
  { timeout: 15_000 }
);

// Secondary: wait for a semantics node
await page.locator('flt-semantics-host').locator('[aria-label="Member List"]')
  .waitFor({ state: 'attached', timeout: 10_000 });
```

---

## 4. Login Strategy and Session Reuse

### 4.1 Flow

```
START
  │
  ├─ Session file exists?
  │   ├─ YES → Create context with storageState
  │   │         Navigate to app home
  │   │         Check: are we on an authenticated page?
  │   │           ├─ YES → Session valid. Continue.
  │   │           └─ NO  → Session expired. Delete file. Go to FRESH LOGIN.
  │   └─ NO  → Go to FRESH LOGIN.
  │
  ├─ FRESH LOGIN
  │   Navigate to login URL
  │   Wait for email input (use aria-label or flt-semantics locator)
  │   Type email
  │   Type password
  │   Click submit
  │   Wait for: post-login network response OR navigation to authenticated route
  │   Save storageState to file
  │   Continue.
  │
  └─ SESSION EXPIRY DURING RUN
      Any flow step that detects a redirect to login (via URL check or 401 response)
      triggers re-auth automatically, then retries the interrupted step.
```

### 4.2 Session Expiry Detection

Two complementary checks:

1. **URL-based**: After any navigation, check if `page.url()` matches the login route pattern.
2. **Response-based**: In the global response listener, watch for `401` or `403` status codes on API calls.

When detected:
- Log a warning.
- Call `auth.login(page)` to re-authenticate.
- Retry the current flow step (up to 1 re-auth attempt per flow run to avoid infinite loops).

### 4.3 Credential Management

```
PUSHPRESS_EMAIL=...
PUSHPRESS_PASSWORD=...
PUSHPRESS_BASE_URL=https://members.pushpress.com
```

- These are **client/member** credentials, not admin credentials.
- Loaded via `dotenv` from `.env` file (not committed).
- Validated at startup — fail fast with clear error if missing.

---

## 5. Data Capture Strategy

### 5.1 Endpoint Discovery

Before writing flows, discover the relevant API endpoints:

1. **Manual inspection**: Open the app in Chrome DevTools, navigate through the target screens, observe the Network tab. Record:
   - URL pattern (e.g., `/api/v1/members?...`)
   - HTTP method
   - Response content-type (must be `application/json`)
   - Response shape (key fields)

2. **Automated discovery mode** (CLI command):
   ```
   npx cfcnx discover --record 60
   ```
   Navigates to the app, logs in, then records all JSON API responses for N seconds while the user manually interacts in the browser (headful mode). Outputs a summary of discovered endpoints to `output/discovered-endpoints.json`.

### 5.2 Response Filtering

Each flow defines capture rules:

```typescript
interface CaptureRule {
  name: string;              // Friendly name for this data set
  urlPattern: string;        // Substring or regex to match response URL
  method?: string;           // GET, POST, etc. (default: any)
  statusCode?: number;       // Expected status (default: 200)
  transform?: (data: unknown) => unknown;  // Optional transform/extract
  validate?: (data: unknown) => boolean;   // Optional shape validation
}
```

The `NetworkCapture` module:
1. Receives every response event.
2. Matches against active capture rules.
3. Parses JSON body.
4. Applies `transform` if defined (e.g., extract `response.data.items`).
5. Applies `validate` if defined (e.g., check required fields exist).
6. Pushes to an in-memory buffer keyed by `name`.
7. Buffer is flushed by the flow runner at designated "save" steps.

### 5.3 JSON Schema Validation (Optional Hardening)

- Use `zod` schemas to validate captured data at runtime.
- If validation fails, log a warning (do not abort) and save the raw data with a `_validation_errors` key in the output.

---

## 6. Flow Design

### 6.1 Flow Definition Interface

```typescript
interface FlowStep {
  name: string;                       // Human-readable step name
  action: (ctx: FlowContext) => Promise<void>;  // What to do
  waitFor?: WaitCondition;            // What signals completion
  captureRules?: CaptureRule[];       // Network responses to capture during this step
  retries?: number;                   // Override default retry count (default: 2)
  critical?: boolean;                 // If true, failure aborts the flow (default: true)
  screenshotBefore?: boolean;         // Debug: screenshot before step
  screenshotAfter?: boolean;          // Debug: screenshot after step
}

interface FlowDefinition {
  name: string;
  description: string;
  steps: FlowStep[];
}

interface FlowContext {
  page: Page;
  config: AppConfig;
  capture: NetworkCapture;
  logger: Logger;
  artifacts: ArtifactCollector;
}
```

### 6.2 Example Flow: Extract Workout History (Client)

```typescript
const workoutHistoryFlow: FlowDefinition = {
  name: 'workout-history',
  description: 'Navigate to workout history screen and extract workout data for the logged-in member',
  steps: [
    {
      name: 'navigate-to-workouts',
      action: async (ctx) => {
        await ctx.page.goto(`${ctx.config.baseUrl}/workouts`);
      },
      waitFor: { response: { urlPattern: '/api/v1/workouts' } },
      captureRules: [
        {
          name: 'workouts',
          urlPattern: '/api/v1/workouts',
          transform: (data: any) => data.results ?? data.data ?? data,
        },
      ],
    },
    {
      name: 'paginate-if-needed',
      action: async (ctx) => {
        // Check if there is a "next page" indicator, click it, wait for response
        // Repeat until no more pages
        // This step accumulates capture data across pages
      },
      waitFor: { idle: 2000 },
      captureRules: [
        { name: 'workouts', urlPattern: '/api/v1/workouts' },
      ],
      retries: 3,
    },
  ],
};
```

### 6.3 Example Flow: Client Login

```typescript
const loginFlow: FlowDefinition = {
  name: 'login',
  description: 'Sign in to the client/member app',
  steps: [
    {
      name: 'navigate-to-login',
      action: async (ctx) => {
        await ctx.page.goto(`${ctx.config.baseUrl}/login`);
      },
      waitFor: { selector: '[aria-label="Email"]' },
    },
    {
      name: 'fill-credentials',
      action: async (ctx) => {
        // Fill in email and password from ctx.config.credentials
      },
      waitFor: { selector: '[aria-label="Sign In"]' },
    },
    {
      name: 'submit-login',
      action: async (ctx) => {
        // Click submit, wait for confirmation response
      },
      waitFor: { response: { urlPattern: '/api/v1/login' } },
    },
    {
      name: 'wait-for-login-success',
      action: async (ctx) => {
        // Wait for URL to move off /login or a known post-login indicator
      },
    },
    {
      name: 'save-session',
      action: async (ctx) => {
        // Persist storage state to disk
      },
    },
  ],
};
```

### 6.4 Flow Runner Execution Loop

```
for each step in flow.steps:
  1. Activate step's captureRules on NetworkCapture
  2. Take screenshot if screenshotBefore
  3. Execute step.action(ctx) wrapped in retry(step.retries):
     a. Run the action
     b. If waitFor defined, await the condition (response match / URL match / timeout)
     c. If action throws, check if it's a session-expiry error
        - If yes: re-auth, then retry this step once
        - If no: throw to retry loop
  4. Take screenshot if screenshotAfter
  5. Deactivate step's captureRules
  6. Flush captured data for this step to the output buffer
  7. Log step completion with timing
```

---

## 7. Error Handling, Retries, and Debugging

### 7.1 Retry Strategy

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;    // default: 3
    baseDelayMs: number;    // default: 1000
    maxDelayMs: number;     // default: 10000
    backoffFactor: number;  // default: 2
    retryOn?: (error: Error) => boolean;  // default: always retry
  }
): Promise<T>;
```

- Applied at the flow-step level (not individual Playwright calls).
- Delay: `min(baseDelay * backoffFactor^attempt, maxDelay)` with 10% jitter.
- Non-retryable errors (e.g., config errors, auth failures after re-auth): thrown immediately.

### 7.2 Failure Artifacts

On any unrecoverable step failure:

1. **Screenshot**: `artifacts/{flowName}-{stepName}-{timestamp}.png`
2. **Trace**: `artifacts/{flowName}-{timestamp}.zip` (Playwright trace with snapshots)
3. **Page HTML snapshot**: `artifacts/{flowName}-{stepName}-{timestamp}.html` (for DOM debugging)
4. **Network log**: `artifacts/{flowName}-{stepName}-{timestamp}-network.json` (last N captured responses)

### 7.3 Structured Logging

Use `pino` with child loggers per module:

```typescript
const logger = pino({ level: config.logLevel });
const authLogger = logger.child({ module: 'auth' });
const flowLogger = logger.child({ module: 'flow', flow: flowName });

flowLogger.info({ step: stepName, attempt: 2 }, 'Retrying step');
```

- Log levels: `debug`, `info`, `warn`, `error`.
- Default: `info` in production, `debug` with `--verbose` flag.
- All log entries include: timestamp, module, flow name (if applicable).

---

## 8. JSON Output Schema and Naming

### 8.1 Output Envelope

Every output file wraps the captured data in a metadata envelope:

```json
{
  "meta": {
    "tool": "cfcnx-pushpress-cli",
    "version": "0.1.0",
    "flow": "workout-history",
    "appUrl": "https://members.pushpress.com",
    "timestamp": "2026-02-02T20:15:30.000Z",
    "durationMs": 4523,
    "stepsCompleted": 2,
    "stepsTotal": 2,
    "success": true
  },
  "data": {
    "workouts": [ ... ]
  },
  "errors": []
}
```

### 8.2 File Naming Convention

```
output/{flow-name}/{YYYY-MM-DD}/{flow-name}-{HHmmss}.json
```

Example: `output/workout-history/2026-02-02/workout-history-201530.json`

- Directory per flow, subdirectory per date.
- Allows easy identification of the latest run.
- A symlink `output/{flow-name}/latest.json` points to the most recent output.

---

## 9. CLI Interface

### 9.1 Commands

```
cfcnx <command> [options]

Commands:
  run <flow>          Execute a named flow
  discover            Record API endpoints (interactive, headful)
  list                List available flows
  validate-session    Check if saved session is still valid
  clean               Remove old output/artifacts

Options (global):
  --config <path>     Path to config file (default: .env)
  --headless          Run in headless mode (default: true)
  --no-headless       Run with visible browser
  --slow-mo <ms>      Slow down actions by N ms (default: 0)
  --output-dir <dir>  Output directory (default: ./output)
  --verbose           Enable debug logging
  --save-traces       Save Playwright traces even on success
  --dry-run           Log actions without executing them
  --timeout <ms>      Global step timeout (default: 30000)

Examples:
  cfcnx run login                                   # Sign in as a client/member
  cfcnx run workout-history                          # Extract workout data
  cfcnx run workout-history --no-headless --slow-mo 500
  cfcnx discover --record 120
  cfcnx validate-session
```

### 9.2 Implementation

- Use `commander` for argument parsing.
- Config resolution order (last wins): defaults → `.env` file → env vars → CLI flags.
- `run` command: loads flow by name from registry, creates browser, runs flow, writes output.
- `discover` command: launches headful browser, logs in, records all JSON responses for the specified duration, writes endpoint summary.

---

## 10. Testing Approach

### 10.1 Unit Tests (Vitest)

| What | How |
|---|---|
| Config merging | Mock `process.env`, test defaults/overrides |
| NetworkCapture filtering | Feed mock response objects, assert buffer contents |
| Output writer | Assert file content and directory structure on disk (use temp dir) |
| Retry utility | Mock async functions that fail N times, assert retry count and delays |
| CaptureRule matching | Test URL patterns, status filters, transforms |

### 10.2 Integration Tests (Playwright Test)

- **Login smoke test**: Actually log in to the app (use real credentials from CI secrets or skip in CI). Assert session file is created and contains expected cookie keys.
- **Session reuse test**: Log in, save state, create new context with state, assert authenticated page loads.
- **Flow execution test**: Run a known flow end-to-end, assert output file is created with expected schema.

Integration tests are gated behind an env flag (`RUN_INTEGRATION=true`) so they don't run in every CI pipeline.

### 10.3 Dry Run Mode

`--dry-run` mode:
- Logs every step action description without executing Playwright calls.
- Validates flow definition structure (all steps have names, actions are functions).
- Validates config (all required env vars present).
- Useful for CI validation that flow definitions are well-formed.

### 10.4 Mock Responses for Development

- Save real API responses to `tests/mocks/responses/` during `discover` mode.
- Use Playwright's `page.route()` in test mode to intercept requests and serve mocked responses.
- Enables flow development/debugging without hitting the real app.

---

## 11. Implementation Milestones

### Milestone 1: MVP (Core Loop)

**Goal**: One working flow that logs in, navigates, captures network data, and writes JSON.

- [ ] Project scaffolding: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
- [ ] Config module: load env vars with `dotenv`, validate required fields, export typed config
- [ ] Logger module: `pino` setup with configurable level
- [ ] Browser module: launch Playwright Chromium, create context with optional storageState
- [ ] Auth module: login flow (navigate to login page, fill email/password, submit, wait for auth response, save storageState)
- [ ] Session validation: restore storageState, navigate to app, detect if session is valid
- [ ] NetworkCapture module: register response listener, match against CaptureRule, buffer results
- [ ] Output module: write JSON envelope to correct directory path, create symlink to latest
- [ ] FlowRunner: iterate steps, call actions, apply capture rules, handle waitFor conditions
- [ ] Login flow: sign in as a client/member
- [ ] Workout-history flow: extract workout data for the logged-in member
- [ ] CLI entry point: `run` command with basic options (`--headless`, `--verbose`, `--output-dir`)

### Milestone 2: Reliability Hardening

**Goal**: Handle failures gracefully, support repeated unattended runs.

- [ ] Retry module: exponential backoff wrapper
- [ ] Apply retries to flow steps
- [ ] Session expiry detection mid-flow (URL redirect check + 401 response check)
- [ ] Automatic re-auth and step retry on session expiry
- [ ] Failure artifacts: screenshot, trace, HTML snapshot, network log
- [ ] Structured error reporting in output JSON `errors` array
- [ ] `validate-session` CLI command
- [ ] `clean` CLI command (remove old outputs/artifacts by age)

### Milestone 3: Developer Experience

**Goal**: Make it easy to add new flows and debug issues.

- [ ] `discover` command: headful recording of API endpoints
- [ ] `list` command: print available flows with descriptions
- [ ] `--dry-run` mode
- [ ] `--slow-mo` and `--no-headless` for interactive debugging
- [ ] `--save-traces` flag for success-case trace capture
- [ ] Unit tests for config, capture, output, retry modules
- [ ] Mock response infrastructure for offline flow testing
- [ ] Flow template/generator: `cfcnx new-flow <name>` scaffolds a flow file

### Milestone 4: Optional Enhancements

**Goal**: Quality-of-life improvements based on real usage.

- [ ] Zod schema validation on captured data with warnings
- [ ] Pagination helper: generic "click next, wait for response, accumulate" utility
- [ ] Diff mode: compare current run output with previous run, highlight changes
- [ ] Cron-friendly exit codes: 0 = success, 1 = partial failure, 2 = total failure
- [ ] Notification hook: optional webhook/callback on completion (for integration with other tools)
- [ ] Configurable flow parameters (e.g., date ranges, filters) passed via CLI `--param key=value`

---

## 12. Flutter Web-Specific Considerations

### 12.1 HTML Renderer Semantics

The app uses Flutter's HTML renderer, which produces:
- A `<flt-glass-pane>` element containing the canvas.
- A `<flt-semantics-host>` shadow DOM with accessibility nodes.
- Semantics nodes have `aria-label`, `role`, and sometimes `aria-*` attributes.

For UI actions (clicking buttons/links):
```typescript
// Use the semantics tree to locate interactive elements
const button = page.locator('flt-semantics-host')
  .locator('[role="button"][aria-label="Members"]');
await button.click();
```

For text extraction from the DOM: **avoid this** — prefer network capture. The semantics tree may not contain all visible text, and text in canvas is not in the DOM at all.

### 12.2 Navigation Detection

Flutter Web apps are SPAs. Navigation changes are internal route changes, not full page loads. Detect navigation by:
1. Watching for a specific API call that the target screen triggers.
2. Checking for URL fragment/hash changes (`page.url()` after action).
3. Waiting for a known semantics element that only appears on the target screen.

### 12.3 Timing Considerations

- Flutter apps may have animation durations between screens. Add a small settle delay (200-500ms) after navigation before interacting with elements.
- Use `page.waitForTimeout()` sparingly and only as a supplement to network/element waits, never as the primary wait mechanism.

---

## 13. Security Considerations

| Concern | Mitigation |
|---|---|
| Credentials in code | Env vars only, validated at startup, `.env` in `.gitignore` |
| Session state file | `state/session.json` in `.gitignore`, file permissions `0600` |
| Output data sensitivity | Output dir in `.gitignore`, consider encryption at rest if data is PII |
| Traces contain screenshots | `artifacts/` in `.gitignore`, auto-cleanup via `clean` command |
| Logging sensitive data | Never log credentials; redact auth headers in network logs |

---

## 14. Dependencies

```json
{
  "dependencies": {
    "playwright": "^1.50.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@playwright/test": "^1.50.0",
    "tsx": "^4.19.0"
  }
}
```

- `tsx` for running TypeScript directly during development (`npx tsx src/cli.ts`).
- Build step compiles to `dist/` for distribution (optional for MVP).

---

## 15. Configuration File Reference

### `.env.example`

```bash
# Required
PUSHPRESS_EMAIL=
PUSHPRESS_PASSWORD=
PUSHPRESS_BASE_URL=https://members.pushpress.com

# Optional
HEADLESS=true
SLOW_MO=0
OUTPUT_DIR=./output
LOG_LEVEL=info
GLOBAL_TIMEOUT=30000
SAVE_TRACES=false
```

### `AppConfig` Type

```typescript
interface AppConfig {
  baseUrl: string;
  credentials: {
    email: string;
    password: string;
  };
  headless: boolean;
  slowMo: number;
  outputDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  globalTimeout: number;
  saveTraces: boolean;
  sessionStatePath: string;  // derived: ./state/session.json
  artifactsDir: string;      // derived: ./artifacts
}
```
