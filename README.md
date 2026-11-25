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
                                        analyze.js ──► analysis.json  (one per match)
                                                             │
                                                             ▼
                                              web/db/odds-samples/ ──► website
```

### 1. Fetch (`pipeline/fetch_match.js`)

For one match, it downloads:

- **fixture info:** teams, tournament, start time
- **odds history:** every price change from each bookmaker, up to 3 bookmakers per call (the included matches use Stake, bet365 and 1xBet)
- **settlements:** the API's verdict on every outcome (win, lose, half-win, push...)
- **scores:** final and half-time score, plus the real start and end times of each period

The free API tier allows only 250 requests a month, so every response is
cached under `data/` and never fetched twice. The API key is read from `.env`
and is never written into saved data.

### 2. Analyze (`pipeline/analyze.js`)

For each match:

1. **Find the winners.** Every settled outcome that won (or half-won on Asian
   lines) is kept. A typical match has about 2,300 settled outcomes and about
   280 winners.
2. **Double-check the settlements.** Where possible, the result is also
   computed from the actual score. If the API's settlement disagrees, the
   outcome is moved to `settlementMismatches` and excluded, so a grading error
   in the data feed can never show up as a "winning" bet.
3. **Track the price.** For each winner and each bookmaker, the price history
   is reduced to **open**, **peak** and **close** snapshots with timestamps.
   The peak is tagged `pre-match` or `in-play`.
4. **Normalize market names.** Each provider uses its own market IDs, so
   `market-map.js` maps them to one set of canonical names (`CORRECT_SCORE_1H`,
   `ASIAN_HANDICAP`, `OVER_UNDER_FT`...). That way another odds source could be
   plugged in without changing the analysis.
5. **Write the result** to `data/<matchId>/analysis.json`: match info, scores,
   totals, the single highest winning price, every winner, and the mismatches.

Other scripts:
- `explore.js`: quick look at a match's winners and peak prices in the terminal
- `timeline.js`: SVG chart of one outcome's price through pre-match, both halves, stoppage time and extra time
- `front.html`: standalone viewer; drag an `analysis.json` onto it

### 3. Display (`web/`)

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

```bash
cd pipeline
cp .env.example .env     # then add your ODDSPAPI_KEY
node fetch_match.js <matchId>
node analyze.js <matchId>
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
