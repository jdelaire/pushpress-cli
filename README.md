# CFCNX PushPress CLI

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

### workout-week

Clicks each day in the week and captures workouts for all days. Output includes weekly arrays.

```bash
npx tsx src/cli.ts run workout-week --no-headless --verbose --pause
```

This flow also writes a summary file grouped by day with only `title`, `description`, and `workoutTitle`, plus the detected date:

```text
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-summary.json
```

If `OPENAI_API_KEY` is set, it also writes a formatted markdown summary using the prompt in `./prompts/workout-week-summary.md`:

```text
output/workout-week/YYYY-MM-DD/workout-week-HHmmss-summary.md
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

## Output Files

All flows (except `login`) write JSON output to:

```text
output/<flow-name>/<YYYY-MM-DD>/<flow-name-HHmmss>.json
```

For `schedule-book`, the output includes:
- `data.bookings` for confirmed reservations
- `data.matches` for dry-run matches
- `data.attempts` for skipped or attempted bookings

## Notes

- The CLI will reuse `state/session.json` when available. If the session is invalid, it re-authenticates.
- Use `--pause` to keep the browser open at the end of a run for debugging.
