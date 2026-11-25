# OddsTracker

Next.js app that analyzes settled betting odds and shows the highest winning
odds of every match — the multipliers a bettor could have gotten.

Data comes from [oddspapi.io](https://oddspapi.io): a separate fetch/analyze
pipeline grades every outcome against the real score and exports one analysis
JSON per match. This app reads those files directly — **no database, no
setup**. Everything runs locally.

## Run it

```
npm install
npm run dev
```

Open http://localhost:3000. Done — the World Cup sample matches load from
`db/odds-samples/`.

## Pages

- **Dashboard** (`/`) — analyzed matches; every match links to its own page
- **Match page** (`/events/[id]`) — the highest winning odds of the match, peak odds stamped on a real game clock (using the match's actual period times), and an expandable per-bookmaker markets table
- **Market library** (`/library`) — the canonical market names the analysis normalizes to, built from the data itself

## Adding a match

Drop a new analysis JSON into `db/odds-samples/` and restart the dev server.
Duplicate fixture ids are skipped automatically.

## Project structure

- `app/` — the pages themselves (Next.js App Router): dashboard, match page, market library
- `src/C/` — frontend components (navigation, timeline, markets table)
- `src/styles.ts` — shared Tailwind class strings, `src/gameClock.ts` — game clock logic
- `db/odds-samples/` — the data: one analysis JSON per match
- `db/store.ts` — loads and normalizes the analysis files in memory; all queries live here

Import paths: `@/...` points to `src/`, `@db/...` points to `db/`.

## How the analysis pipeline works

- Every outcome in an analysis file is a settled winner, verified against the
  actual score (feed grading errors are excluded at the source).
- Odds are tracked per bookmaker with open/peak/close snapshots, so the app
  can show when the highest price appeared — pre-match or at a real game minute.
- Market ids from the provider are normalized to canonical names
  (`CORRECT_SCORE_1H`, `ASIAN_HANDICAP`, ...), so any odds source can be
  plugged into the same analysis.
