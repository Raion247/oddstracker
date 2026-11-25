#!/usr/bin/env node
/**
 * Explore locally saved fixture data (no API calls, pure local reads).
 *
 * Usage:
 *   node explore.js <fixtureId>
 *
 * Prints:
 *   - which files exist and their sizes
 *   - bookmakers + markets present in odds/historical data
 *   - snapshot counts per market (how rich the timeline is)
 *   - settlements joined with historical odds:
 *       for every outcome that WON, the max price it ever traded at
 *       -> sorted, so the top line is literally "the highest multi that hit"
 */

const fs = require("fs");
const path = require("path");

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error("Usage: node explore.js <fixtureId>");
  process.exit(1);
}

const dir = path.join(__dirname, "data", fixtureId);
if (!fs.existsSync(dir)) {
  console.error(`No data for ${fixtureId}. Run: node fetch_match.js fetch ${fixtureId}`);
  process.exit(1);
}

const load = (f) => {
  const p = path.join(dir, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

// market names, if the reference has been fetched
const marketNames = {};
const marketsRef = (() => {
  const p = path.join(__dirname, "data", "markets.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
})();
if (Array.isArray(marketsRef)) {
  for (const m of marketsRef) marketNames[m.marketId] = m.marketName ?? m.name ?? "";
} else if (marketsRef && typeof marketsRef === "object") {
  for (const [id, m] of Object.entries(marketsRef)) marketNames[id] = m.marketName ?? m.name ?? String(m);
}
const mName = (id) => (marketNames[id] ? `${id} (${marketNames[id]})` : String(id));

console.log(`\n=== Files in data/${fixtureId}/ ===`);
for (const f of fs.readdirSync(dir)) {
  const kb = (fs.statSync(path.join(dir, f)).size / 1024).toFixed(1);
  console.log(`  ${f.padEnd(40)} ${kb} KB`);
}

// ---------- fixture ----------
const fixture = load("fixture.json");
if (fixture) {
  console.log(`\n=== Fixture ===`);
  console.log(`  ${fixture.participant1Name ?? "?"} vs ${fixture.participant2Name ?? "?"}`);
  console.log(`  start: ${fixture.startTime}  status: ${fixture.statusId}  tournament: ${fixture.tournamentName ?? fixture.tournamentId ?? "?"}`);
}

// ---------- current odds ----------
const odds = load("odds.json");
if (odds?.bookmakerOdds) {
  console.log(`\n=== Current odds snapshot (odds.json) ===`);
  for (const [book, bo] of Object.entries(odds.bookmakerOdds)) {
    const markets = Object.keys(bo.markets ?? {});
    console.log(`  ${book}: ${markets.length} markets -> [${markets.slice(0, 15).join(", ")}${markets.length > 15 ? ", ..." : ""}]`);
  }
}

// ---------- historical ----------
// Collect all historical.*.json files and merge: book -> market -> outcome -> snapshots[]
const histFiles = fs.readdirSync(dir).filter((f) => f.startsWith("historical.") && f.endsWith(".json"));
const hist = {}; // book -> markets object
for (const f of histFiles) {
  const data = load(f);
  for (const [book, bo] of Object.entries(data?.bookmakers ?? {})) hist[book] = bo;
}

if (Object.keys(hist).length) {
  console.log(`\n=== Historical odds timelines ===`);
  for (const [book, bo] of Object.entries(hist)) {
    console.log(`  ${book}:`);
    for (const [marketId, market] of Object.entries(bo.markets ?? {})) {
      let outcomes = 0, snaps = 0;
      for (const outcome of Object.values(market.outcomes ?? {})) {
        for (const snapList of Object.values(outcome.players ?? {})) {
          outcomes++;
          snaps += Array.isArray(snapList) ? snapList.length : 1;
        }
      }
      console.log(`    market ${mName(marketId).padEnd(30)} ${String(outcomes).padStart(3)} outcomes, ${String(snaps).padStart(5)} price snapshots`);
    }
  }
}

// ---------- settlements + join ----------
const settlements = load("settlements.json");
if (settlements?.markets) {
  console.log(`\n=== Settlements: winning outcomes joined with historical prices ===`);
  const winners = [];

  for (const [marketId, market] of Object.entries(settlements.markets)) {
    for (const [outcomeId, outcome] of Object.entries(market.outcomes ?? {})) {
      for (const [playerId, player] of Object.entries(outcome.players ?? {})) {
        const result = player.result ?? player;
        if (result !== "WIN" && result !== "HALFWIN") continue;

        // find max historical price for this market/outcome/player across books
        let best = null;
        for (const [book, bo] of Object.entries(hist)) {
          const snapList = bo.markets?.[marketId]?.outcomes?.[outcomeId]?.players?.[playerId];
          if (!Array.isArray(snapList)) continue;
          for (const snap of snapList) {
            if (snap.price != null && (!best || snap.price > best.price)) {
              best = { price: snap.price, book, at: snap.createdAt };
            }
          }
        }
        winners.push({ marketId, outcomeId, playerId, result, best });
      }
    }
  }

  winners.sort((a, b) => (b.best?.price ?? 0) - (a.best?.price ?? 0));
  if (!winners.length) {
    console.log("  No WIN outcomes found - fixture may not be settled yet (statusId 2 = Finished).");
  }
  for (const w of winners.slice(0, 25)) {
    const priceStr = w.best
      ? `peak price ${w.best.price} @ ${w.best.book} (${w.best.at})`
      : "no historical price found for tracked bookmakers";
    console.log(`  [${w.result}] market ${mName(w.marketId)}, outcome ${w.outcomeId}: ${priceStr}`);
  }
  if (winners.length > 25) console.log(`  ... and ${winners.length - 25} more winning outcomes`);

  if (winners[0]?.best) {
    const top = winners[0];
    console.log(`\n>>> HIGHEST MULTI THAT HIT: ${top.best.price}x  (market ${mName(top.marketId)}, outcome ${top.outcomeId}, ${top.best.book})`);
    console.log(`    Run 'node fetch_match.js markets' if market names are missing above.`);
  }
} else {
  console.log(`\n(no settlements.json - run fetch again once the match is Finished)`);
}