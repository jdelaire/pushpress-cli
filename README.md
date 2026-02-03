# PushPress CLI

A small CLI that automates the PushPress Members web app to:
- Log in
- Extract workouts
- Book classes by day/time

This tool is built for the client/member experience at https://members.pushpress.com.

## Requirements

- Node.js
- Playwright browsers

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npx playwright install
```

## Quick Start

1. Create a `.env` file (see Configuration below).
2. Install dependencies and Playwright browsers.
3. Run `list` to see available flows.
4. Run a flow, optionally with `--no-headless --pause --verbose` for debugging.

Example:

```bash
npx tsx src/cli.ts list
npx tsx src/cli.ts run login --no-headless --pause --verbose
```

## Configuration

Create a `.env` file in the project root (or pass `--config <path>`):

```bash
PUSHPRESS_EMAIL=you@example.com
PUSHPRESS_PASSWORD=your-password
PUSHPRESS_BASE_URL=https://members.pushpress.com
OPENAI_API_KEY=your-openai-key
```

Optional OpenAI settings (used for workout-week markdown summaries):
- `OPENAI_MODEL`: default `gpt-3.5-turbo-16k`
- `OPENAI_PROMPT_PATH`: any file path (default: `./prompts/workout-week-summary.md`)

Example with a custom config file:

```bash
npx tsx src/cli.ts config --config ./envs/pushpress.env
```

Validate the config before running a flow:

```bash
npx tsx src/cli.ts config --config ./envs/pushpress.env --validate
```

## Commands

List available flows:

```bash
npx tsx src/cli.ts list
```

Show resolved config:

```bash
npx tsx src/cli.ts config
```

Validate config:

```bash
npx tsx src/cli.ts config --validate
```

Validate current session:

```bash
npx tsx src/cli.ts validate-session --verbose
```

Run a flow:

```bash
npx tsx src/cli.ts run <flow-name>
```

### Global Options

All known values:
- `--config <path>`: any file path (default: `.env`)
- `--verbose`: boolean flag
- `--headless` / `--no-headless`: boolean flag (default: `--headless`)
- `--slow-mo <ms>`: integer milliseconds (e.g., `250`)
- `--timeout <ms>`: integer milliseconds (e.g., `30000`)
- `--pause`: boolean flag
- `--dry-run`: boolean flag (logs steps without executing)

Common option patterns:

```bash
# Debug a flow with a visible browser and slower actions
npx tsx src/cli.ts run workout-week --no-headless --slow-mo 250 --pause --verbose

# Use a non-default config file
npx tsx src/cli.ts run login --config ./envs/pushpress.env

# Increase timeouts for slow networks
npx tsx src/cli.ts run workout-history --timeout 60000 --verbose
```

## Flows

### login

Logs into the Members app and saves a session to `state/session.json`.

```bash
npx tsx src/cli.ts run login --no-headless --verbose
```

### workout-history

Extracts workout history (network capture) while on the Workouts tab.

```bash
npx tsx src/cli.ts run workout-history --no-headless --verbose
```

Optional:
- `--workout-type <name>`: selects a workout type from the dropdown (e.g., `Bootcamp`, `HYROX`).
  - When provided, output filenames include the workout type slug (e.g., `workout-history-201530-bootcamp.json`).

Typical usage:

```bash
npx tsx src/cli.ts run workout-history --no-headless --verbose --pause
```

### workout-week

Clicks each day in the week and captures workouts for all days. Output includes weekly arrays.

```bash
npx tsx src/cli.ts run workout-week --no-headless --verbose --pause
```

Optional:
- `--workout-type <name>`: selects a workout type from the dropdown (e.g., `PRVN Burn`).
  - When provided, output filenames include the workout type slug (e.g., `workout-week-201530-prvn-burn.json`).

This flow also writes a summary file grouped by day with only `title`, `description`, and `workoutTitle`, plus the detected date:

```text
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-summary.json
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-<workout-type>-summary.json
```

If `OPENAI_API_KEY` is set, it also writes a formatted markdown summary using the prompt in `./prompts/workout-week-summary.md`:

```text
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-summary.md
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-<workout-type>-summary.md
```

Example: JSON only (no OpenAI key):

```bash
npx tsx src/cli.ts run workout-week --no-headless --verbose
```

Example: with OpenAI markdown summary:

```bash
OPENAI_API_KEY=your-openai-key npx tsx src/cli.ts run workout-week --no-headless --verbose
```

### schedule-book

Books classes for specific days and a time. This flow is dry-run by default.

Required:
- `--days <list>`
- `--time <label>`

Optional:
All known values:
- `--days <list>`: comma/space separated day keys: `sun, mon, tue, wed, thu, fri, sat`
- `--time <label>`: time label as shown in UI, e.g. `6:00 AM`, `5:00 PM`
- `--class <name>`: class name label as shown in UI (default: `CrossFit`)
- `--type <name>`: alias for `--class`
- `--category <name>`: one of `Reservations`, `Classes`, `Appointments`, `Events` (default: `Classes`)
- `--week <which>`: `current`, `next`, or an integer offset like `2`, `3` (max 6)
- `--waitlist`: allow waitlist-only booking
- `--confirm`: perform booking actions (without this it is dry-run)

Example dry-run:

```bash
npx tsx src/cli.ts run schedule-book --days mon,wed,fri --time "5:00 PM" --class "CrossFit" --no-headless --verbose --pause
```

Example confirm booking:

```bash
npx tsx src/cli.ts run schedule-book --days mon,wed,fri --time "5:00 PM" --class "CrossFit" --confirm --no-headless --verbose --pause
```

Target next week:

```bash
npx tsx src/cli.ts run schedule-book --week next --days fri --time "5:00 PM" --class "CrossFit" --confirm --no-headless --verbose --pause
```

Target next-next week:

```bash
npx tsx src/cli.ts run schedule-book --week 2 --days fri --time "5:00 PM" --class "CrossFit" --confirm --no-headless --verbose --pause
```

Common booking variations:

```bash
# Book a different class name and allow waitlist
npx tsx src/cli.ts run schedule-book --days tue,thu --time "6:00 AM" --class "Olympic Lifting" --waitlist --confirm

# Book from the Reservations category
npx tsx src/cli.ts run schedule-book --category Reservations --days mon --time "12:00 PM" --confirm

# Dry-run for a future week offset
npx tsx src/cli.ts run schedule-book --week 3 --days fri --time "5:00 PM"
```

## Output Files

All flows (except `login`) write JSON output to:

```text
output/<flow-name>/<YYYY-MM-DD>/<flow-name-HHmmss>.json
```

For `schedule-book`, the output includes:
- `data.bookings` for confirmed reservations
- `data.matches` for dry-run matches
- `data.attempts` for skipped or attempted bookings

## Troubleshooting

- If login fails, delete `state/session.json` and run `login` again.
- If the UI is slow or flaky, use `--timeout 60000` and `--slow-mo 250`.
- If the flow seems stuck, rerun with `--no-headless --pause --verbose` to inspect the browser state.
- If OpenAI summaries fail, verify `OPENAI_API_KEY` and `OPENAI_PROMPT_PATH` (if set).

## Notes

- The CLI will reuse `state/session.json` when available. If the session is invalid, it re-authenticates.
- Use `--pause` to keep the browser open at the end of a run for debugging.
