# Progress Log

## 2026-02-02
Step 1 complete: project scaffolding and a minimal CLI `list` command.

Completed
- Added `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Added starter types in `src/types.ts`
- Added flow registry in `src/flows/index.ts`
- Added CLI entry in `src/cli.ts`

Test this step
1. `npm install`
2. `npx tsx src/cli.ts list`

Expected result
- Output lists `login` and `workout-history` flows.

---

Step 2 complete: config loading, validation, and a CLI `config` command.

Completed
- Added `src/config.ts` to load `.env` (or a custom path), parse types, and derive paths
- Added `AppConfig` and related types in `src/types.ts`
- Added `config` command to show resolved config and optionally validate

Test this step
1. `npx tsx src/cli.ts config`
2. `npx tsx src/cli.ts config --validate`

Expected result
- `config` prints a redacted config JSON.
- `config --validate` reports missing `PUSHPRESS_EMAIL`/`PUSHPRESS_PASSWORD` unless you set them in `.env`.

---

Step 3 complete: logger setup and CLI wiring.

Completed
- Added `src/logger.ts` to create a pino logger with pretty output in TTY
- Added global `--verbose` option to override log level to `debug`
- Wired logger into `list` and `config` commands

Test this step
1. `npx tsx src/cli.ts list --verbose`
2. `npx tsx src/cli.ts config --verbose`

Expected result
- A debug log line appears before the command output.

---

Step 4 complete: Playwright browser module and `run` command stub.

Completed
- Added `src/browser.ts` to launch Chromium with config options
- Added `run` command stub that launches and closes a browser for a named flow
- Added CLI overrides for `--headless`, `--slow-mo`, and `--timeout`
- Added friendly error message when Playwright browsers are not installed

Test this step
1. If you have not installed Playwright browsers yet: `npx playwright install`
2. `npx tsx src/cli.ts run login`
3. `npx tsx src/cli.ts run workout-history --no-headless`

Expected result
- Browser launches and closes cleanly.
- Logs indicate the flow is a stub and no actions ran.

---

Step 5 complete: session-aware context creation and auth helpers.

Completed
- Added `src/auth.ts` with session state helpers
- Updated `src/browser.ts` to load `storageState` when `state/session.json` exists
- Added session state existence logging to the `run` command

Test this step
1. `mkdir -p state`
2. `printf '{"cookies":[],"origins":[]}' > state/session.json`
3. `npx tsx src/cli.ts run login`

Expected result
- Log line shows `sessionStateExists: true`.
- Browser launches and closes cleanly.

Cleanup (optional)
- `rm -f state/session.json`

---

Step 6 complete: login flow skeleton + dry-run execution.

Completed
- Replaced `sign-up` with `login` flow in the registry
- Added `src/flow-runner.ts` with dry-run support
- Added `src/flows/login.flow.ts` (login navigation + selectors + save session)
- Removed unused sign-up config fields from `.env.example` and `AppConfig`
- Added `--dry-run` to `run` and wired flow execution

Test this step
1. `npx tsx src/cli.ts list`
2. `npx tsx src/cli.ts run login --dry-run`

Expected result
- `list` shows `login` and `workout-history`.
- `run login --dry-run` logs each step without launching a browser.

---

Step 7 complete: basic login success detection and session persistence.

Completed
- Added `waitForLoginSuccess` in `src/auth.ts` to wait for the URL to move off `/login`
- Added `wait-for-login-success` step to `src/flows/login.flow.ts`

Test this step
1. Ensure `PUSHPRESS_EMAIL` and `PUSHPRESS_PASSWORD` are set in `.env`
2. `npx tsx src/cli.ts run login --no-headless`

Expected result
- Login completes without timing out.
- `state/session.json` is created.

---

Step 7.1 complete: updated default base URL to the members domain.

Completed
- Updated `PUSHPRESS_BASE_URL` default to `https://members.pushpress.com`

Test this step
1. `npx tsx src/cli.ts config`

Expected result
- `baseUrl` resolves to `https://members.pushpress.com` unless overridden in `.env`.

---

Step 8 complete: login flow updated for Members App landing page.

Completed
- Added a “Let’s get started” click step before filling credentials

Test this step
1. `npx tsx src/cli.ts run login --no-headless`

Expected result
- The browser clicks “Let’s get started” and then fills the login form.

---

Step 8.1 complete: improved “Let’s get started” click handling.

Completed
- Added multiple click strategies and a coordinate click fallback for the Flutter semantics tree

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- Debug logs show a click attempt (role/text/semantics or coordinate), and the login form opens.

---

Step 8.2 complete: faster click attempts + bounding-box fallback.

Completed
- Reduced per-attempt timeouts to avoid long hangs
- Added bounding-box based mouse click before coordinate fallback

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- It moves quickly through click attempts and opens the login dialog.

---

Step 8.3 complete: wait for the button text to appear before clicking.

Completed
- Added a polling wait (up to 15s) for the “Let’s get started” text

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- It waits a few seconds for the button to render, then opens the login dialog.

---

Step 8.4 complete: faster click retries + robust credential fill.

Completed
- Reduced get-started click attempt timeout to 2s per selector
- Added a bounding-box click instead of waiting for Playwright “visible”
- Added robust email/password fill that tries labels, roles, placeholders, and semantics

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The dialog opens faster.
- Email and password fields are filled.

---

Step 8.5 complete: semantics-first typing for Flutter fields.

Completed
- Added aria-label based selectors for `Username/email` and `Password`
- Switched to click + keyboard typing (works better for Flutter web inputs)
- Reduced per-attempt timeouts for field filling

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- Email and password fields fill reliably.

---

Step 8.6 complete: direct semantics-tree coordinate typing.

Completed
- Added a direct aria-label lookup inside the Flutter semantics tree and clicks by bounding box

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The cursor focuses the correct input and typing appears.

---

Step 8.7 complete: semantics field detection by position.

Completed
- Added detection of large semantics text fields and typed by vertical order

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The email and password fields are filled using the two largest semantics fields.

---

Step 8.8 complete: enable Flutter semantics placeholder (if present).

Completed
- Added a step to click `flt-semantics-placeholder` inside `flt-glass-pane` (if it exists)

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The debug log shows `Flutter semantics placeholder click attempted`.

---

Step 8.9 complete: avoid `__name` in `page.evaluate`.

Completed
- Rewrote `page.evaluate` blocks to use plain loops (no inner functions) to prevent `__name` injection

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The flow no longer errors with `__name is not defined`.

---

Step 8.10 complete: de-duplicate semantics fields by row.

Completed
- Clustered semantics fields by Y position and chose the largest field per row
- Clears the field before typing email/password

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- Email fills in the first field and password fills in the second field (not the same field).

---

Step 8.11 complete: wait for login sheet animation to settle.

Completed
- Added a stability check on the username/email field Y position before typing

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- Typing occurs after the sheet finishes animating, with full email visible.

---

Step 8.12 complete: use Flutter text editing host + login button fallback.

Completed
- Added `flt-text-editing-host` typing for more reliable input (especially passwords)
- Added a dedicated login button click strategy with a coordinate fallback

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- Full email and password are entered.
- The `Log in` button is clicked.

---

Step 8.13 complete: login success verification via semantics + storage keys.

Completed
- `waitForLoginSuccess` now checks for the login form to disappear
- Logs localStorage/sessionStorage keys to help confirm auth success

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The flow errors if the login form stays visible after timeout.
- Debug logs show storage keys (no values) during the success check.

---

Step 8.14 complete: always wait for login success + better login button targeting.

Completed
- `waitForLoginSuccess` now runs even when the URL doesn’t change (SPA behavior)
- Added a login-button text wait and more debug around login button clicking

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose`

Expected result
- The flow waits for the login form to disappear (or throws if it doesn’t).
- Debug logs show the login button click strategy used.

---

Step 8.15 complete: pause option to inspect post-login UI.

Completed
- Added `--pause` to keep the browser open after the flow completes

Test this step
1. `npx tsx src/cli.ts run login --no-headless --verbose --pause`

Expected result
- After the flow completes, the browser stays open until you press Enter.

---

Step 9 complete: session validation and reuse.

Completed
- Added `validateSession` in `src/auth.ts` using the `Home` nav label
- Added `validate-session` CLI command
- `run` now validates session and re-runs login when needed for non-login flows

Test this step
1. `npx tsx src/cli.ts validate-session --verbose`
2. `npx tsx src/cli.ts run workout-history --no-headless --verbose`

Expected result
- `validate-session` prints whether the session is valid.
- `run workout-history` re-auths if the session is invalid.

---

Step 9.1 complete: throttle session validation logs.

Completed
- Session validation debug logs now emit only when state changes or every ~2s

---

Step 9.2 complete: session validation uses bottom nav + landing detection.

Completed
- Validation now treats any of `Home/Schedule/Workouts/Social` as logged-in
- Detects the landing screen via “Let’s get started” and marks session invalid

---

Step 10 complete: workout-history capture MVP.

Completed
- Added `src/capture.ts` for JSON response capture
- Added `src/output.ts` for JSON output files + latest symlink
- Extended flow runner to collect capture data
- Implemented `workout-history` flow with Workouts nav click + capture window
- `run` now writes output files for non-login flows

Test this step
1. `npx tsx src/cli.ts run workout-history --no-headless --verbose --pause`

Expected result
- Browser opens Workouts tab.
- JSON responses are captured to `output/workout-history/<date>/workout-history-<time>.json`.

---

Step 11 complete: workout-week flow (single weekly output).

Completed
- Added `workout-week` flow to iterate the week day-number buttons (left-to-right, Sunday first)
- Captures all days into `workouts-week` and `workout-history-week` arrays with a `day` field

Test this step
1. `npx tsx src/cli.ts run workout-week --no-headless --verbose --pause`

Expected result
- Workouts tab opens.
- Each day-number button is clicked in sequence.
- Output file includes `workouts-week` and `workout-history-week`.

---

Step 11.1 complete: wait for day-number buttons + enable semantics.

Completed
- Added a semantics-placeholder click before searching for day buttons
- Added a wait loop for day-number buttons to appear
- Loosened day-chip detection to any numeric label and widened Y threshold
- Capturing `workout`, `history`, and `week-raw` JSON per day into weekly arrays

---

Step 12 complete: schedule-book flow (parameterized days/time).

Completed
- Added `schedule-book` flow to book classes by `--days` and `--time`
- Added `--confirm` safety gate (dry-run by default)
- Added optional `--class` filter (default: CrossFit)

Test this step (dry-run)
1. `npx tsx src/cli.ts run schedule-book --days mon,wed,fri --time \"5:00 PM\" --verbose --pause`

Test this step (live booking)
1. `npx tsx src/cli.ts run schedule-book --days mon,wed,fri --time \"5:00 PM\" --confirm --verbose --pause`

Expected result
- Dry-run logs matching slots without booking.
- With `--confirm`, it clicks a matching slot and books it.

---

Step 12.1 complete: schedule day-chip detection updated.

Completed
- Day chips now look in the top half of the schedule view and match numeric labels like \"2\" or \"Mon 2\"

---

Step 12.2 complete: select category tab before booking.

Completed
- Added a category toggle click after opening Schedule (default: Classes)

---

Step 12.3 complete: slot matching + waitlist handling.

Completed
- Slot matching now requires both time and class text
- Skips Reserved/Class Full/Waitlist unless `--waitlist` is set
- Added `--waitlist` CLI flag

---

Step 12.4 complete: open class details before booking.

Completed
- Time slots now match by time only (class verified in details view)
- Clicks the class card to open the booking menu
- Skips if no booking action is available

---

Step 12.5 complete: category parameter for schedule booking.

Completed
- Added `--category` (Classes/Appointments/Events/Reservations) to `schedule-book`

---

Step 12.6 complete: class type alias parameter.

Completed
- Added `--type` as an alias for `--class`

---

Step 12.7 complete: more robust class-card opening.

Completed
- Normalized time matching to handle spacing (e.g., `6:00AM` vs `6:00 AM`)
- Waits for time slots to render after switching days
- Added multi-click fallback targets and class-label clicking before booking
- Added debug logs for slot clicks and slot counts

Test this step
1. `npx tsx src/cli.ts run schedule-book --days mon,wed,fri --time "6:00 AM" --class "CrossFit" --confirm --no-headless --verbose --pause`

Expected result
- The script clicks the time slot, opens the class card, and attempts to reserve (or skips with a log if not available).

---

Step 12.8 complete: schedule-book output includes booking results.

Completed
- Added `bookings` (confirmed reserved/waitlisted) to schedule-book output
- Added `matches` (dry-run) and `attempts` (skipped/attempted) for visibility

Test this step
1. `npx tsx src/cli.ts run schedule-book --days fri --time "5:00 PM" --class "CrossFit" --confirm --no-headless --verbose --pause`

Expected result
- Output JSON contains `data.bookings` with any confirmed reservations.

---

Step 12.9 complete: optional week offset toggle.

Completed
- `--week` now opens the date picker (down-arrow) and selects the target date (today + 7×week offset)
- Arrow click targets the Wednesday column position (matches the UI arrow) and avoids the top filters

Test this step
1. `npx tsx src/cli.ts run schedule-book --week 2 --days mon --time "6:00 AM" --class "CrossFit" --confirm --no-headless --verbose --pause`

Expected result
- The date picker opens, the target week date is selected, and the day row updates before booking.

---

Step 12.10 complete: resilient day selection.

Completed
- If day buttons are missing, the flow scrolls to the top, re-enables semantics, and retries
- If still missing, it logs a warning and skips the day instead of crashing

Test this step
1. `npx tsx src/cli.ts run schedule-book --days mon,tue --time "6:00 AM" --class "CrossFit" --confirm --no-headless --verbose --pause`

Expected result
- No crash when day buttons are not detected; flow continues with remaining days.

---

Step 12.11 complete: skip \"Reserve Soon\" slots.

Completed
- If a slot label includes `RESERVE SOON`, the flow records it and stops further processing

Test this step
1. `npx tsx src/cli.ts run schedule-book --days mon --time "6:00 AM" --class "CrossFit" --confirm --no-headless --verbose --pause`

Expected result
- `RESERVE SOON` slots are logged, recorded, and the flow exits early.

---

Step 13 complete: workout-week summary output.

Completed
- Added a summary writer for `workout-week` with `title`, `description`, `workoutTitle`
- Summary is grouped by day and includes the detected date
- Summary file uses `-summary` suffix next to the full JSON

Test this step
1. `npx tsx src/cli.ts run workout-week --no-headless --verbose`

Expected result
- A `workout-week-<time>-summary.json` file is created with a compact list of workout fields.

---

Step 13.1 complete: robust summary extraction.

Completed
- Summary now uses a fallback day label if date parsing fails
- Handles capture records with nested `{ data: { day, data } }` payloads

Test this step
1. `npx tsx src/cli.ts run workout-week --no-headless --verbose`

Expected result
- `summaryByDay` is populated even when only `week-raw` is present.
