# OddsTracker

Finds the **highest odds that actually won** in a football match: the best
multiplier a bettor could have gotten on a bet that paid out, and *when* that
price was on offer (before kickoff or at a specific game minute).

Built around the 2026 FIFA World Cup. The repo includes 9 analyzed knockout
matches, so the website works right after cloning, with no API key.

> Example from the included data: **France – England, correct score 0:4 at
> half time, 201.00x**, available before kickoff.

The project has two parts:

| Folder | What it is |
|---|---|
| [`pipeline/`](pipeline/) | Node.js scripts that download odds from the API and analyze them into one JSON file per match |
| [`web/`](web/) | Next.js website that displays those analysis files |

---

## How the analysis works

```
oddspapi.io API ──► fetch_match.js ──► data/<matchId>/  (raw API responses, cached)
                                             │
                                             ▼
                                        analyze.js ──► data/<matchId>/analysis.json + report.html
                                                             │
                                                             ▼
                                        export.js ──► web/db/odds-samples/<home>-<away>.json ──► website
```

### 1. Fetch (`pipeline/fetch_match.js`)

**First, find the match.** You need the API's match ID, so list the matches
in a time window and pick one:

```bash
node fetch_match.js list 2026-07-14 2026-07-15
# id1000001653452533  2026-07-14T19:00:00.000Z  [Finished]  France vs Spain  (World Cup)
```

(Or `list-tournament <tournamentId>` for every match in one tournament; the
`tournaments` command shows the IDs.) See [Run it](#pipeline-needs-your-own-api-key)
for the full steps.

**Then fetch it.** `node fetch_match.js fetch <matchId> [bookmakers]`
downloads, for that match:

- **fixture info** (`fixture.json`): teams, tournament, scheduled and actual start/end time
- **current odds** (`odds.json`): the latest snapshot from every bookmaker
- **odds history** (`historical.<books>.json`): every price change, with timestamps. The API allows 3 bookmakers per call, so longer lists are split into several calls. Default: `stake,bet365,1xbet` (one call), which the included matches use
- **settlements** (`settlements.json`): the API's verdict on every outcome (win, lose, half-win, push...)
- **scores** (`scores.json`): final and half-time score, plus the real start and end times of each period

All commands:

| Command | What it does |
|---|---|
| `list <from> <to>` | Lists matches with their IDs between two dates (`YYYY-MM-DD`, one day or two consecutive days) |
| `list-tournament <tournamentId>` | Lists every match in a tournament, with IDs |
| `tournaments` | Lists soccer tournaments and their IDs |
| `fetch <matchId> [bookmakers]` | Downloads everything for one match (above) |
| `markets` | Downloads the market reference (`data/markets.json`). **Run once before analyzing**: `analyze.js` uses it for market names, lines and outcome names |
| `latest <tournamentId> [bookmakers]` | Fetches the most recent finished match in a tournament |
| `bookmakers [filter]` | Lists bookmaker slugs to use in the `[bookmakers]` argument |

The free API tier allows only 250 requests a month, so every response is
cached under `pipeline/data/` and never fetched twice (delete a file to
refetch it). `fetch` uses about 5 requests per match. The API key is read from
`pipeline/.env` and is never written into saved data.

### 2. Analyze (`pipeline/analyze.js`)

`node analyze.js <matchId>` works only on the saved files (no API calls):

1. **Find the winners.** Every settled outcome with a result of win or
   half-win is kept. A typical match has about 2,300 settled outcomes and
   about 280 winners.
2. **Double-check the settlements.** For full-time/half-time results,
   European handicaps and correct scores, the result is also computed from the
   actual score. If the API's settlement disagrees, the outcome goes to
   `settlementMismatches` and is excluded, so a grading error in the data feed
   can never show up as a "winning" bet. Other market types are taken from the
   API as-is.
3. **Grade what the API skips.** Correct-score markets that have odds history
   but no settlement are graded from the score (`settlementSource: "computed"`).
4. **Track the price.** For each winner and each bookmaker, the price history
   is reduced to **open**, **peak** and **close** snapshots with timestamps.
   Prices recorded more than 2 minutes after the final whistle are ignored. The
   peak is tagged `pre-match` or `in-play` based on the actual kickoff time.
5. **Normalize market names.** Each provider uses its own market IDs, so
   `market-map.js` maps them to one set of canonical names (`CORRECT_SCORE_1H`,
   `ASIAN_HANDICAP`, `OVER_UNDER_FT`...). That way another odds source could be
   plugged in without changing the analysis.
6. **Write the results.** `data/<matchId>/analysis.json` has match info,
   scores, totals, the single highest winning price, every winner with its
   full details, the mismatches, and the raw market reference entries. It also
   writes `data/<matchId>/report.html`: `front.html` with the analysis built
   in, which you can open straight in a browser.

### 3. Export (`pipeline/export.js`)

`node export.js <matchId> [outfile.json]` writes a slim copy of
`analysis.json` for the website, to `web/db/odds-samples/<home>-<away>.json`
(lowercase, e.g. `france-spain.json`). It keeps only the match info, scores,
totals, the highest winning price, and for each winner its market, line,
outcome and open/peak/close price per bookmaker. `analysis.json` itself is
left unchanged.

Other scripts:
- `explore.js <matchId>`: terminal summary of the saved files, bookmakers, markets, snapshot counts, and winners sorted by peak price
- `timeline.js <matchId> <marketId> <outcomeId> [outfile.svg]`: SVG chart of one outcome's price through pre-match, both halves, stoppage time and extra time
- `front.html`: standalone viewer; drag an `analysis.json` onto it

### 4. Display (`web/`)

The website reads every `analysis.json` in `web/db/odds-samples/` when it
starts. There's no database: `db/store.ts` loads the files into memory.

- **Dashboard** (`/`): every analyzed match and its highest winning odds
- **Match page** (`/events/[id]`): the top winning odds, each peak placed on
  a **real game clock**. Kickoff, half time, second-half start and full time
  come from the match's actual timestamps, so a peak shows as `54'` or `45+2`
  instead of a raw time. There's also a per-bookmaker table of every market.
- **Market library** (`/library`): every canonical market the analysis
  understands and which provider IDs map to it

---

## Stack

| Part | Tech |
|---|---|
| Website | [Next.js 15](https://nextjs.org) (App Router, server components), React 19, TypeScript 5, Tailwind CSS 4 |
| Pipeline | Plain Node.js, no dependencies |
| Data | [oddspapi.io](https://oddspapi.io) odds API, stored as JSON files (no database) |

---

## Run it

### Website (uses the included sample matches)

Requires Node.js 18.18 or newer.

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000.

To add a match, put its `analysis.json` in `web/db/odds-samples/` and restart
the dev server. Duplicate matches are skipped automatically.

### Pipeline (needs your own API key)

**1. Set up** (once):

```bash
cd pipeline
cp .env.example .env               # then add your ODDSPAPI_KEY
node fetch_match.js markets        # market names reference, needed by analyze.js
```

**2. Find a match ID.** List the soccer matches on the days you want. The
range can cover one day or two consecutive days (the API allows less than 48
hours per request):

```bash
node fetch_match.js list 2026-07-14 2026-07-15
```

Each line shows the match ID, start time, status, teams and tournament:

```
id1000001653452533  2026-07-14T19:00:00.000Z  [Finished]  France vs Spain  (World Cup)
```

Pick a match marked `[Finished]`: settlements and the final score only exist
after the game. A single day can list 200+ matches, including simulated
"SRL" copies of real ones (e.g. `France SRL vs Spain SRL`), so filter the
output by team name:

```bash
node fetch_match.js list 2026-07-14 2026-07-15 | grep -i france              # macOS / Linux / Git Bash
node fetch_match.js list 2026-07-14 2026-07-15 | Select-String -Pattern france   # PowerShell
``` For a longer period, run `list` once per two days (each call
costs one request, and results are cached).

**3. Fetch, analyze and export it:**

```bash
node fetch_match.js fetch <matchId>    # about 5 API requests
node analyze.js <matchId>              # writes data/<matchId>/analysis.json + report.html
node export.js <matchId>               # writes web/db/odds-samples/<home>-<away>.json
```

---

## Project structure

```
pipeline/                 fetch + analyze scripts
web/
  app/                    pages: dashboard, match page, market library
  src/C/                  components: navigation, odds timeline, markets table
  src/gameClock.ts        maps timestamps to game minutes (45+2, HT, 90+4...)
  db/store.ts             loads and normalizes the analysis files in memory
  db/odds-samples/        the analyzed matches
```

---

## Data and disclaimer

Odds data comes from [oddspapi.io](https://oddspapi.io). This project is not
affiliated with oddspapi or any bookmaker. The odds shown are historical and
for analysis only. This is not betting advice.
