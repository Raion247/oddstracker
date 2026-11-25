#!/usr/bin/env node
/**
 * Analyze saved fixture data and EXPORT it: writes data/<fixtureId>/analysis.json
 * with every winning outcome, its peak historical price, and resolved
 * market/outcome names + handicap lines from the markets reference.
 *
 * Usage:
 *   node analyze.js <fixtureId>
 *
 * No API calls - pure local reads of data/ files.
 */

const fs = require("fs");
const path = require("path");

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error("Usage: node analyze.js <fixtureId>");
  process.exit(1);
}

const dir = path.join(__dirname, "data", fixtureId);
const load = (f) => {
  const p = path.join(dir, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

// ---------- markets reference: build marketId -> entry, and outcome lookup ----------
const refPath = path.join(__dirname, "data", "markets.json");
const marketsRaw = fs.existsSync(refPath) ? JSON.parse(fs.readFileSync(refPath, "utf8")) : null;

const marketRef = {}; // marketId (string) -> raw reference entry
if (Array.isArray(marketsRaw)) {
  for (const m of marketsRaw) {
    const id = m.marketId ?? m.id;
    if (id != null) marketRef[String(id)] = m;
  }
} else if (marketsRaw && typeof marketsRaw === "object") {
  for (const [id, m] of Object.entries(marketsRaw)) marketRef[id] = m;
}

// canonical market taxonomy (optional - analysis works without it)
let marketMap = null;
try { marketMap = require("./market-map.js"); } catch { /* no map file - skip canonical tagging */ }
const canonicalOf = (mRef) => (marketMap && mRef ? marketMap.resolve("oddspapi", mRef) : null);

const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  return null;
};

function marketName(marketId) {
  const m = marketRef[String(marketId)];
  return pick(m, ["marketName", "name", "label"]) ?? `market ${marketId}`;
}

/** Handicap/total line for a market, if the reference exposes one. */
function marketLine(marketId) {
  const m = marketRef[String(marketId)];
  if (!m) return null;
  const line = pick(m, ["specialValue", "specialvalue", "line", "handicap", "hcp", "total", "sv"]);
  if (line != null) return String(line);
  // sometimes the line is baked into the name, e.g. "European Handicap 0:2"
  const nm = pick(m, ["marketName", "name", "label"]) ?? "";
  const match = nm.match(/[-+]?\d+(\.\d+)?\s*:\s*[-+]?\d+(\.\d+)?|[-+]\d+(\.\d+)?/);
  return match ? match[0] : null;
}

/** Outcome name: search plausible shapes in the market reference entry. */
function outcomeName(marketId, outcomeId) {
  const m = marketRef[String(marketId)];
  if (!m) return null;
  const candidates = [m.outcomes, m.outcomeList, m.selections];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      const o = c.find((x) => String(x.outcomeId ?? x.id) === String(outcomeId));
      if (o) return pick(o, ["outcomeName", "name", "label"]);
    } else if (typeof c === "object") {
      const o = c[String(outcomeId)];
      if (o) return typeof o === "string" ? o : pick(o, ["outcomeName", "name", "label"]);
    }
  }
  return null;
}

// ---------- load fixture data ----------
const fixture = load("fixture.json");
const settlements = load("settlements.json");
const scores = load("scores.json");
if (!settlements?.markets) {
  console.error("No settlements.json with markets - fetch the fixture first (and match must be Finished).");
  process.exit(1);
}

// merge historical files: book -> markets
const hist = {};
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("historical.") && f.endsWith(".json"))) {
  for (const [book, bo] of Object.entries(load(f)?.bookmakers ?? {})) hist[book] = bo;
}

// ---------- settlement verification ----------
// Recompute expected results from the actual score for market types we can
// grade, and compare against the API's settlement. Catches feed grading bugs
// (e.g. European Handicap "X" outcomes observed mis-settled by the provider).

function getPeriodScore(scoresObj, period) {
  const p = scoresObj?.scores?.periods;
  if (!p) return null;
  const aliases = {
    // "fulltime" markets settle on the 90-minute score. Prefer the regulation
    // `fulltime` period; only fall back to `result` (which BUNDLES extra time)
    // when no regulation period exists. Reading `result` first mis-grades every
    // match that went to extra time.
    fulltime: ["fulltime", "regulation", "result"],
    firsthalf: ["p1", "firsthalf", "halftime"],
    p1: ["p1"],
  };
  for (const key of aliases[period] ?? [period]) {
    const s = p[key];
    if (s) return { home: s.participant1Score, away: s.participant2Score };
  }
  return null;
}

/**
 * Returns expected result ("WIN"/"LOSE"/"PUSH") for an outcome, or null if
 * this market type isn't graded here. Only grades types we're sure about.
 */
function expectedResult(mRef, outName, scoresObj) {
  if (!mRef || !outName || !scoresObj) return null;
  const s = getPeriodScore(scoresObj, mRef.period ?? "fulltime");
  if (!s) return null;

  const canonical = canonicalOf(mRef);

  if (canonical === "EUROPEAN_HANDICAP" || canonical === "EUROPEAN_HANDICAP_1H" || mRef.marketType === "spreads-european") {
    const adj = s.home + (mRef.handicap ?? 0) - s.away;
    const winner = adj > 0 ? "1" : adj < 0 ? "2" : "X";
    return outName === winner ? "WIN" : "LOSE";
  }
  if (
    canonical === "FULL_TIME_RESULT" || canonical === "FIRST_HALF_RESULT" || canonical === "SECOND_HALF_RESULT" ||
    mRef.marketType === "moneyline" || (mRef.marketName === "Full Time Result" && mRef.marketLength === 3)
  ) {
    const winner = s.home > s.away ? "1" : s.home < s.away ? "2" : "X";
    return outName === winner ? "WIN" : "LOSE";
  }
  // correct/exact score: canonical mapping or outcome names shaped like "1:2"
  if (/^\d+\s*:\s*\d+$/.test(outName)) {
    const [h, a] = outName.split(":").map((x) => parseInt(x, 10));
    return h === s.home && a === s.away ? "WIN" : "LOSE";
  }
  return null; // other market types: not verified (extend as needed)
}

/** True if every outcome of this market is a score-shaped name like "1:2". */
function isScoreMarket(mRef) {
  const outs = mRef?.outcomes;
  return Array.isArray(outs) && outs.length > 0 && outs.every((o) => /^\d+\s*:\s*\d+$/.test(o.outcomeName ?? ""));
}

// ---------- join settlements with historical peaks ----------
const winners = [];
const allOutcomes = [];

/** Scan historical snapshots across all books for one outcome. */
const matchStart = fixture?.trueStartTime ?? fixture?.startTime ?? null;
const matchEnd = fixture?.trueEndTime ?? null;
const endCutoff = matchEnd ? new Date(new Date(matchEnd).getTime() + 2 * 60 * 1000) : null; // +2min buffer

function priceStats(marketId, outcomeId, playerId) {
  let peak = null, open = null, snapCount = 0, droppedPostMatch = 0;
  const perBook = {};
  for (const [book, bo] of Object.entries(hist)) {
    let snaps = bo.markets?.[marketId]?.outcomes?.[outcomeId]?.players?.[playerId];
    if (!Array.isArray(snaps) || !snaps.length) continue;
    if (endCutoff) {
      const before = snaps.length;
      snaps = snaps.filter((s) => new Date(s.createdAt) <= endCutoff);
      droppedPostMatch += before - snaps.length;
      if (!snaps.length) continue;
    }
    snapCount += snaps.length;
    const sorted = [...snaps].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const bookOpen = sorted[0];
    const bookPeak = sorted.reduce((mx, s) => (s.price > (mx?.price ?? -1) ? s : mx), null);
    perBook[book] = {
      snapshots: snaps.length,
      open: { price: bookOpen.price, at: bookOpen.createdAt },
      peak: { price: bookPeak.price, at: bookPeak.createdAt },
      close: { price: sorted[sorted.length - 1].price, at: sorted[sorted.length - 1].createdAt },
    };
    if (!open || new Date(bookOpen.createdAt) < new Date(open.at)) {
      open = { price: bookOpen.price, at: bookOpen.createdAt, book };
    }
    if (!peak || bookPeak.price > peak.price) {
      peak = { price: bookPeak.price, at: bookPeak.createdAt, book };
    }
  }
  const peakPhase = peak && matchStart ? (new Date(peak.at) < new Date(matchStart) ? "pre-match" : "in-play") : null;
  return { peak, open, snapCount, perBook, peakPhase, droppedPostMatch };
}

for (const [marketId, market] of Object.entries(settlements.markets)) {
  for (const [outcomeId, outcome] of Object.entries(market.outcomes ?? {})) {
    for (const [playerId, player] of Object.entries(outcome.players ?? {})) {
      const result = player.result ?? player;
      const { peak, open, snapCount, perBook, peakPhase } = priceStats(marketId, outcomeId, playerId);

      const oName = outcomeName(marketId, outcomeId);
      const expected = expectedResult(marketRef[String(marketId)], oName, scores);
      // verified: true = matches recomputation, false = CONTRADICTS score, null = not graded
      const verified = expected == null ? null : (expected === result || (expected === "WIN" && result === "HALFWIN"));

      const entry = {
        marketId,
        marketName: marketName(marketId),
        canonical: canonicalOf(marketRef[String(marketId)]),
        line: marketLine(marketId),
        outcomeId,
        outcomeName: oName,
        playerId,
        result,
        settlementSource: "api",
        expectedFromScore: expected,
        verified,
        peakPhase,
        snapshots: snapCount,
        open,
        peak,
        perBook,
      };
      allOutcomes.push(entry);
      // winners must not contradict the actual score; contradicted entries are
      // recorded under settlementMismatches in analysis.json instead
      if ((result === "WIN" || result === "HALFWIN") && verified !== false) winners.push(entry);
    }
  }
}

// ---------- self-grading pass ----------
// Some markets (e.g. Correct Score) have full odds history but are absent from
// the API's settlements. Grade the ones we can compute from the score ourselves.
let computedCount = 0;
const seenMarketIds = new Set(Object.keys(settlements.markets));
const histMarketIds = new Set();
for (const bo of Object.values(hist)) for (const mid of Object.keys(bo.markets ?? {})) histMarketIds.add(mid);

for (const marketId of histMarketIds) {
  if (seenMarketIds.has(marketId)) continue;
  const mRef = marketRef[String(marketId)];
  if (!isScoreMarket(mRef)) continue; // only self-grade score-shaped markets for now

  // collect every outcome/player present in any book's history for this market
  const outcomePlayers = new Map(); // outcomeId -> Set(playerId)
  for (const bo of Object.values(hist)) {
    for (const [oid, o] of Object.entries(bo.markets?.[marketId]?.outcomes ?? {})) {
      if (!outcomePlayers.has(oid)) outcomePlayers.set(oid, new Set());
      for (const pid of Object.keys(o.players ?? {})) outcomePlayers.get(oid).add(pid);
    }
  }
  for (const [outcomeId, playerIds] of outcomePlayers) {
    for (const playerId of playerIds) {
      const oName = outcomeName(marketId, outcomeId);
      const expected = expectedResult(mRef, oName, scores);
      if (expected == null) continue;
      const { peak, open, snapCount, perBook, peakPhase } = priceStats(marketId, outcomeId, playerId);
      const entry = {
        marketId,
        marketName: marketName(marketId),
        canonical: canonicalOf(marketRef[String(marketId)]),
        line: marketLine(marketId),
        outcomeId,
        outcomeName: oName,
        playerId,
        result: expected,
        settlementSource: "computed", // graded by this tool from the score, not by the API
        expectedFromScore: expected,
        verified: true,
        peakPhase,
        snapshots: snapCount,
        open,
        peak,
        perBook,
      };
      allOutcomes.push(entry);
      computedCount++;
      if (expected === "WIN") winners.push(entry);
    }
  }
}

winners.sort((a, b) => (b.peak?.price ?? 0) - (a.peak?.price ?? 0));

const trustedWinners = winners; // contradicted settlements never enter winners
const mismatches = allOutcomes.filter((w) => w.verified === false);

// ---------- write analysis.json ----------
const analysis = {
  fixtureId,
  match: fixture
    ? {
        home: fixture.participant1Name,
        away: fixture.participant2Name,
        startTime: fixture.startTime,
        tournament: fixture.tournamentName,
      }
    : null,
  scores: scores ?? null,
  generatedAt: new Date().toISOString(),
  bookmakers: Object.keys(hist),
  totals: {
    settledOutcomes: allOutcomes.length,
    winningOutcomes: winners.length,
    settlementMismatches: mismatches.length,
  },
  highestMultiThatHit: trustedWinners[0] ?? null,
  winners,
  settlementMismatches: mismatches,
  // raw reference entries for winning markets, so no info is lost even if
  // name/line field guesses above missed something:
  marketReferenceEntries: Object.fromEntries(
    [...new Set(winners.map((w) => w.marketId))].map((id) => [id, marketRef[id] ?? null])
  ),
};

const outPath = path.join(dir, "analysis.json");
fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));

// also emit a self-contained HTML report (front.html template + embedded data)
const templatePath = path.join(__dirname, "front.html");
if (fs.existsSync(templatePath)) {
  const template = fs.readFileSync(templatePath, "utf8");
  if (!template.includes("window.__DATA__")) {
    console.log("\nWARNING: front.html is an outdated version (no embedded-data support) - report.html NOT generated. Replace front.html with the latest one.");
  } else {
    const dataScript = `<script>window.__DATA__=${JSON.stringify(analysis).replace(/</g, "\\u003c")}</script>`;
    const html = template.replace("<script>", dataScript + "\n<script>");
    fs.writeFileSync(path.join(dir, "report.html"), html);
  }
} else {
  console.log("\n(front.html not found next to analyze.js - report.html not generated)");
}

// ---------- console summary ----------
const label = (w) => {
  const nm = w.outcomeName ? `${w.outcomeName}` : `outcome ${w.outcomeId}`;
  const ln = w.line ? ` [line ${w.line}]` : "";
  return `${w.marketName}${ln} - ${nm}`;
};

console.log(`\n${analysis.match ? `${analysis.match.home} vs ${analysis.match.away}` : fixtureId}`);
console.log(`${winners.length} winning outcomes of ${allOutcomes.length} settled`);
if (computedCount) {
  console.log(`(${computedCount} outcomes graded by this tool from the score - markets the API feed does not settle, e.g. Correct Score)`);
}
if (mismatches.length) {
  console.log(
    `NOTE: ${mismatches.length} feed settlements contradicted the actual score (grading bug) - ` +
      `removed from results, kept as evidence under settlementMismatches in analysis.json`
  );
}
console.log(`\nTop 15 winning multis (peak price during full odds history):`);
for (const w of winners.slice(0, 15)) {
  const p = w.peak ? `${String(w.peak.price).padStart(7)}x  @ ${w.peak.book.padEnd(8)} ${w.peak.at}` : "  (no price data)";
  const o = w.open ? ` (opened ${w.open.price})` : "";
  const ph = w.peakPhase === "pre-match" ? "  [PRE-MATCH peak]" : "";
  console.log(`  [${w.result.padEnd(7)}] ${p}  ${label(w)}${o}${ph}`);
}
if (trustedWinners[0]) {
  console.log(`\n>>> HIGHEST MULTI THAT HIT (verified): ${trustedWinners[0].peak?.price}x - ${label(trustedWinners[0])}`);
}
console.log(`\nFull export written to data/${fixtureId}/analysis.json`);
if (fs.existsSync(path.join(dir, "report.html"))) {
  console.log(`Report page written to data/${fixtureId}/report.html - open it in a browser`);
}
if (!winners.some((w) => w.outcomeName)) {
  console.log(
    "NOTE: outcome names could not be resolved from markets.json - " +
      "check marketReferenceEntries inside analysis.json to see the raw reference schema."
  );
}