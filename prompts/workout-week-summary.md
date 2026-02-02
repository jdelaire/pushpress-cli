# Agent Prompt - Extract + Format PushPress Week Summary (Filtered)

You are a coding agent. Your job is to implement a deterministic transformation that takes a PushPress JSON export (workout-week-summary flow) and outputs a clean Markdown file containing only the relevant training pieces.

## Goal

Given an input JSON shaped like:

- root.meta
- root.data.summaryByDay.{sun|mon|tue|wed|thu|fri|sat}.items[] with fields like:
  - title (string)
  - description (string, optional)
  - workoutTitle (string, optional)

Produce a single Markdown document:

- Grouped by day in the order: Sun, Mon, Tue, Wed, Thu, Fri, Sat
- For each day, include only sections we care about (Strength, Weightlifting, Conditioning, Optional Accessories, etc.)
- Exclude: warmups, mobility, and levels variants
- Pretty format descriptions into readable Markdown lines

This is a pure transformation. No network calls. No UI automation. No guessing.

## Filtering Rules (must be exact)

For each day.items entry:

Exclude an item if any of the following is true:

1. title matches (case-insensitive) either:
   - "Warm-Up Flow"
   - "Warm-Up"
2. title contains (case-insensitive) the substring:
   - "levels"
   Examples: [Levels: "The One"], [Levels"Open 13.4"], [Levels :"John Wick"]
3. title equals (case-insensitive):
   - "Mobility"

Include an item if it has a `description` field AND it was not excluded by rules above.

Ignore items that only have `title` with no `description` (those are usually media movement entries).

## Output Markdown Structure (must match)

- Top header: `# Workout Week Summary (Filtered)`
- Then a short "Rule set applied" bullet list (3 bullets) exactly:
  - Excluded: Warm Up, Warm Up Flow
  - Excluded: Any item whose title contains Levels
  - Excluded: Mobility

For each day:

- Day header: `## Sun` (etc.)
- For each included item in original order:
  - Section header: `### <category>`
    - Category mapping:
      - If title is exactly `Weightlifting` -> `Weightlifting`
      - If title is exactly `Strength` or `Strength:` -> `Strength`
      - If title starts and ends with quotes like `"The One"` -> `Conditioning`
      - If title is `Optional Accessories` -> `Optional Accessories`
      - If title starts with `Optional Accessories` (longer text) -> `Optional Accessories`
      - Otherwise default to `Conditioning` (because many named workouts are in quotes, but not all)
  - Under the section header, render a cleaned version of the item:
    - First line should be `workoutTitle` if present and non-empty, otherwise use the `title` stripped of surrounding quotes.
    - Then render the `description` as nicely broken lines.

## Description Pretty Formatting

Input descriptions are often single-line strings with lots of embedded spaces.

Implement a formatting heuristic that improves readability without trying to fully parse CrossFit grammar.

Required behavior:
- Preserve numbers, units, and symbols exactly.
- Convert these patterns into line breaks:
  - `Every `, `For Time`, `AMRAP`, `EMOM`, `Minute`, `Set`, `Score`, `Barbell`, `Dumbbells`, `Box`, `Wall Ball`, `Row`, `Sit-Ups`, `Push-Ups`
  - Also break before `Level` keywords, but note: Level sections are excluded entirely already, so if they leak into descriptions, remove them (see below).

- Normalize separators:
  - Replace ` + ` with ` plus ` ONLY when it is in workout names like `Power Snatch + Overhead Squat` (keep original if unsure).
  - Keep `3+1` as-is.
- Convert `@` to `at` in descriptions, but keep weights identical.

### Remove leaked Level blocks inside descriptions

Some descriptions might include multiple levels inside the same description string.
If the description contains `Level 2:` or `Level 1:` or `Masters` or `Competitor:` or `Travel / Hotel:`
Then:
- Keep only the initial prescription that comes before the first occurrence of `Level 2:` (or `Level 1:` if it appears first).
- Drop everything from that token onward.

This prevents `[Levels: ...]` content from sneaking into normal sections.

## Deduplication (optional but recommended)

The JSON may repeat the same workout on adjacent days (example Sun and Mon).

Implement a dedupe pass:
- For each day, compute a hash key for each included item: `normalized(title + workoutTitle + description)`
- If the exact same set of item keys appears for two days, keep both days in the output (do not delete), but add a note at the bottom:

`## Note`
`Sun and Mon appear duplicated (same Weightlifting, same The One, same Optional Accessories).`

Only add this note when duplication is detected.

## Deliverables

1. A function:
   - `transformWeekSummaryToMarkdown(inputJson: object): string`
2. A minimal CLI:
   - `node transform.js input.json > output.md`
   - Or equivalent in the chosen language
3. Unit tests with at least:
   - Excluding warmups
   - Excluding mobility
   - Excluding levels items
   - Excluding title-only movement entries
   - Dropping leaked level blocks in descriptions
   - Markdown structure and day ordering

## Constraints

- Do not introduce new content.
- Do not reorder items within a day.
- Do not drop punctuation unless required by the rules.
- Output must be stable and deterministic for the same input.
- No external dependencies unless absolutely necessary.

## Example Acceptance Criteria

Given the provided JSON example, the output must contain:
- Sun: Weightlifting, The One, Optional Accessories, Love and Thunder, Optional Accessories or Accessory Finisher
- Tue: Strength/Stability, Speed, Optional Accessories
- No Warm-Up Flow blocks
- No Mobility blocks
- No [Levels: ...] blocks
- No standalone movement titles like Couch Stretch or Bird-Dog Rows

generated_json_summary
