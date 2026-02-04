# Repository Guidelines

## Project Structure & Module Organization
- `src/cli.ts` is the CLI entrypoint. Core modules live in `src/` (e.g., `auth.ts`, `browser.ts`, `capture.ts`, `config.ts`, `output.ts`, `summary.ts`).
- Automation flows live in `src/flows/` and follow the `*.flow.ts` naming pattern (e.g., `workout-week.flow.ts`).
- `prompts/` holds OpenAI prompt templates used for workout summaries.
- Runtime artifacts are written to `output/` and `state/` (session storage). Treat these as local-only.
- Convenience scripts: `week-workouts.sh`, `book-next-week.sh`.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npx playwright install` installs Playwright browsers required for automation.
- `npx tsx src/cli.ts list` lists available flows.
- `npx tsx src/cli.ts run <flow>` runs a flow (add `--no-headless --pause --verbose` to debug).
- `npx tsx src/cli.ts config --validate` validates `.env` or `--config` settings.
- `npm run build` compiles TypeScript to `dist/`.
- `npm run start` runs the compiled CLI (`dist/cli.js`) after a build.

## Coding Style & Naming Conventions
- TypeScript (`strict` mode) with 2-space indentation and semicolons.
- Prefer single quotes for strings unless escaping is clearer.
- Flow files use kebab-case names ending in `.flow.ts`.

## Testing Guidelines
- No automated test suite is wired into `package.json` yet.
- If adding tests, use Vitest (`npx vitest`) and name files `*.test.ts`. Keep tests in `tests/` or alongside source (e.g., `src/__tests__/`).
- Flows hit a live site; avoid accidental bookings and prefer `--dry-run` or a non-confirming mode for validation.

## Commit & Pull Request Guidelines
- Commit messages follow a lightweight conventional style in history (e.g., `feat: ...`, `docs: ...`). Keep subjects short and imperative.
- PRs should include: a concise summary, commands run, and any relevant output paths (e.g., `output/workout-week/...`).
- If you add flags, flows, or config fields, update `README.md` and `.env.example`.

## Security & Configuration
- Use `.env` or `--config` for credentials. Never commit secrets or `state/session.json`.
- Redact personal data in logs or sample outputs shared in PRs.
