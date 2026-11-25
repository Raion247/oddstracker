#!/usr/bin/env node
/**
 * oddspapi.io match data fetcher with local caching.
 *
 * Every API response is saved as raw JSON under ./data/ and NEVER re-fetched
 * if the file already exists (free tier = 250 req/month, so cache everything).
 * Delete a file if you want a fresh copy.
 *
 * Setup:
 *   export ODDSPAPI_KEY=your_key_here
 *
 * Usage:
 *   node fetch_match.js tournaments                         # list soccer tournaments (cached)
 *   node fetch_match.js list 2026-07-08 2026-07-10          # list soccer fixtures in date range (<48h apart)
 *   node fetch_match.js list-tournament <tournamentId>      # list fixtures for one tournament (e.g. World Cup)
 *   node fetch_match.js markets                             # market ID reference (101 = Full Time Result, etc.)
 *   node fetch_match.js fetch <fixtureId> [bookmakers]      # fetch EVERYTHING for one fixture
 *
 * `fetch` grabs, per fixture:
 *   - fixture.json           basic info (teams, start time, status)
 *   - odds.json              current/latest odds snapshot, all bookmakers
 *   - historical.<books>.json  full odds timeline (every price change, timestamped)
 *   - settlements.json       WIN/LOSE result per outcome  <-- "which bet actually hit"
 *   - scores.json            score data
 *
 * Notes from the API docs:
 *   - /historical-odds accepts MAX 3 bookmakers per call (loop for more)
 *   - /historical-odds cooldown: 5000ms; /settlements: 2000ms  -> script sleeps between calls
 *   - historical response top key is "bookmakers" and players["0"] is a LIST of snapshots
 *     (live /odds uses "bookmakerOdds" and players["0"] is a single object) - watch out
 *   - historical data exists for fixtures since January 2026
 *   - default bookmakers below: pinnacle,bet365 (sharp + big coverage)
 */

const fs = require("fs");
const path = require("path");

// Tiny .env loader (zero deps): reads KEY=value lines from ./.env if present.
// Existing env vars win over the file.
(() => {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
})();

const BASE = "https://api.oddspapi.io/v4";
const API_KEY = process.env.ODDSPAPI_KEY;
const DATA_DIR = path.join(__dirname, "data");
const SPORT_SOCCER = 10;
const DEFAULT_BOOKMAKERS = "stake,bet365,1xbet"; // 3 books = exactly one historical-odds call

if (!API_KEY) {
  console.error("Missing ODDSPAPI_KEY env var. Get your key at oddspapi.io account settings.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function savePath(...parts) {
  const p = path.join(DATA_DIR, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

/** GET with caching: if cacheFile exists, read it instead of hitting the API. */
async function getCached(endpoint, params, cacheFile) {
  if (fs.existsSync(cacheFile)) {
    console.log(`  [cache] ${path.relative(__dirname, cacheFile)}`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("apiKey", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  console.log(`  [api]   GET /${endpoint} ${JSON.stringify(params)}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${endpoint} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  console.log(`  [saved] ${path.relative(__dirname, cacheFile)}`);
  return data;
}

// ---------- commands ----------

async function cmdTournaments() {
  const data = await getCached(
    "tournaments",
    { sportId: SPORT_SOCCER },
    savePath("tournaments.soccer.json")
  );
  for (const t of data) {
    console.log(
      `${String(t.tournamentId).padStart(6)}  ${t.categoryName ?? "?"} / ${t.tournamentName}` +
        `  (future: ${t.futureFixtures}, live: ${t.liveFixtures})`
    );
  }
}

async function cmdMarkets() {
  const data = await getCached("markets", {}, savePath("markets.json"));
  console.log(`Saved market reference (${Array.isArray(data) ? data.length : Object.keys(data).length} entries).`);
  console.log("Open data/markets.json to find the marketId for Correct Score, Full Time Result, etc.");
}

async function cmdList(from, to) {
  if (!from || !to) {
    console.error("Usage: node fetch_match.js list <fromDate> <toDate>   (ISO dates, <48h apart)");
    process.exit(1);
  }
  // NOTE: no hasOdds filter here - it appears to mean "has ACTIVE odds", which
  // excludes finished matches. We want past fixtures too. Window kept under 48h.
  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:00Z`;
  const data = await getCached(
    "fixtures",
    { sportId: SPORT_SOCCER, from: fromIso, to: toIso },
    savePath("fixtures", `soccer.${from}_${to}.json`)
  );
  printFixtures(data);
}

async function cmdListTournament(tournamentId) {
  if (!tournamentId) {
    console.error("Usage: node fetch_match.js list-tournament <tournamentId>");
    process.exit(1);
  }
  const data = await getCached(
    "fixtures",
    { tournamentId },
    savePath("fixtures", `tournament.${tournamentId}.json`)
  );
  printFixtures(data);
}

function printFixtures(fixtures) {
  const statusNames = { 0: "Upcoming", 1: "LIVE", 2: "Finished", 3: "Cancelled" };
  for (const f of fixtures) {
    console.log(
      `${f.fixtureId}  ${f.startTime}  [${statusNames[f.statusId] ?? f.statusId}]  ` +
        `${f.participant1Name ?? f.participant1Id} vs ${f.participant2Name ?? f.participant2Id}` +
        (f.tournamentName ? `  (${f.tournamentName})` : "")
    );
  }
  console.log(`\n${fixtures.length} fixtures. Pick a Finished one and run:  node fetch_match.js fetch <fixtureId>`);
}

async function cmdFetch(fixtureId, bookmakersArg) {
  if (!fixtureId) {
    console.error("Usage: node fetch_match.js fetch <fixtureId> [bookmakers]");
    process.exit(1);
  }
  const bookmakers = (bookmakersArg || DEFAULT_BOOKMAKERS).split(",").map((s) => s.trim());
  const dir = fixtureId;

  console.log(`\nFetching all data for ${fixtureId} (bookmakers: ${bookmakers.join(", ")})\n`);

  // 1. Fixture info
  const fixture = await getCached("fixture", { fixtureId }, savePath(dir, "fixture.json"))
    .catch(async (e) => {
      // some plans expose fixture info only via /fixtures search; not fatal
      console.log(`  (fixture endpoint failed: ${e.message.split(":")[0]} - continuing)`);
      return null;
    });
  if (fixture) {
    console.log(`  Match: ${fixture.participant1Name ?? "?"} vs ${fixture.participant2Name ?? "?"} (${fixture.startTime ?? "?"})`);
  }
  await sleep(1000);

  // 2. Current odds snapshot (all books offering this fixture)
  await getCached("odds", { fixtureId, oddsFormat: "decimal" }, savePath(dir, "odds.json"));
  await sleep(2000);

  // 3. Historical odds - max 3 bookmakers per call, 5s cooldown
  for (let i = 0; i < bookmakers.length; i += 3) {
    const chunk = bookmakers.slice(i, i + 3);
    const tag = chunk.join("-");
    await getCached(
      "historical-odds",
      { fixtureId, bookmakers: chunk.join(",") },
      savePath(dir, `historical.${tag}.json`)
    );
    await sleep(5200);
  }

  // 4. Settlements: which outcomes WON/LOST - the core of "highest multi that hit"
  await getCached("settlements", { fixtureId }, savePath(dir, "settlements.json"));
  await sleep(2200);

  // 5. Scores
  await getCached("scores", { fixtureId }, savePath(dir, "scores.json")).catch((e) =>
    console.log(`  (scores failed: ${e.message.split(":")[0]} - not all fixtures have score data)`)
  );

  console.log(`\nDone. Everything is in data/${dir}/`);
  console.log(`Next: node explore.js ${fixtureId}   to get a summary of what's inside.`);
}

async function cmdLatest(tournamentId, bookmakersArg) {
  if (!tournamentId) {
    console.error("Usage: node fetch_match.js latest <tournamentId> [bookmakers]");
    process.exit(1);
  }
  const fixtures = await getCached(
    "fixtures",
    { tournamentId },
    savePath("fixtures", `tournament.${tournamentId}.json`)
  );
  const finished = fixtures
    .filter((f) => f.statusId === 2)
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  if (!finished.length) {
    console.error("No finished fixtures in this tournament yet.");
    process.exit(1);
  }
  const latest = finished[0];
  console.log(
    `Latest finished: ${latest.participant1Name ?? latest.participant1Id} vs ` +
      `${latest.participant2Name ?? latest.participant2Id} (${latest.startTime})`
  );
  await sleep(1000);
  await cmdFetch(latest.fixtureId, bookmakersArg);
}

async function cmdBookmakers(filter) {
  const data = await getCached("bookmakers", {}, savePath("bookmakers.json"));
  const list = Array.isArray(data) ? data : Object.values(data);
  const needle = (filter ?? "").toLowerCase();
  let shown = 0;
  for (const b of list) {
    const slug = b.bookmakerSlug ?? b.slug ?? "";
    const name = b.bookmakerName ?? b.name ?? "";
    if (needle && !slug.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) continue;
    console.log(`  ${String(slug).padEnd(24)} ${name}`);
    shown++;
  }
  console.log(`\n${shown} bookmakers${needle ? ` matching "${filter}"` : ""}. Use the LEFT column (slug) in fetch/latest commands.`);
}

// ---------- main ----------

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "tournaments") await cmdTournaments();
    else if (cmd === "markets") await cmdMarkets();
    else if (cmd === "list") await cmdList(a, b);
    else if (cmd === "list-tournament") await cmdListTournament(a);
    else if (cmd === "fetch") await cmdFetch(a, b);
    else if (cmd === "latest") await cmdLatest(a, b);
    else if (cmd === "bookmakers") await cmdBookmakers(a);
    else {
      console.log("Commands: tournaments | markets | bookmakers [filter] | list <from> <to> | list-tournament <id> | latest <tournamentId> [bookmakers] | fetch <fixtureId> [bookmakers]");
    }
  } catch (e) {
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  }
})();