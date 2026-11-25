#!/usr/bin/env node
/**
 * export.js - write a slim copy of one match's analysis for the website.
 *
 * Reads data/<fixtureId>/analysis.json (made by analyze.js, left untouched) and
 * writes ../web/db/odds-samples/<home>-<away>.json (lowercase), keeping only
 * what the site uses:
 *   fixtureId, match, scores, totals, highestMultiThatHit,
 *   winners[]: marketId, marketName, canonical, line, outcomeName,
 *              perBook: { <book>: { open, peak, close } }  (each {price, at})
 *
 * Usage:
 *   node export.js <fixtureId> [outfile.json]
 *
 * No API calls - pure local reads.
 */

const fs = require("fs");
const path = require("path");

const [fixtureId, outArg] = process.argv.slice(2);
if (!fixtureId) {
  console.error("Usage: node export.js <fixtureId> [outfile.json]");
  process.exit(1);
}

const src = path.join(__dirname, "data", fixtureId, "analysis.json");
if (!fs.existsSync(src)) {
  console.error(`No analysis for ${fixtureId}. Run: node analyze.js ${fixtureId}`);
  process.exit(1);
}
const a = JSON.parse(fs.readFileSync(src, "utf8"));

const point = (p) => (p ? { price: p.price, at: p.at } : p);

const slim = {
  fixtureId: a.fixtureId,
  match: a.match,
  scores: a.scores,
  totals: a.totals,
  highestMultiThatHit: a.highestMultiThatHit,
  winners: (a.winners ?? []).map((w) => ({
    marketId: w.marketId,
    marketName: w.marketName,
    canonical: w.canonical,
    line: w.line,
    outcomeName: w.outcomeName,
    perBook: Object.fromEntries(
      Object.entries(w.perBook ?? {}).map(([book, b]) => [
        book,
        { open: point(b.open), peak: point(b.peak), close: point(b.close) },
      ])
    ),
  })),
};

const slug = (s) => String(s ?? "unknown").toLowerCase().trim().replace(/\s+/g, "-");
const outPath = outArg
  ? path.resolve(outArg)
  : path.join(__dirname, "..", "web", "db", "odds-samples",
      `${slug(a.match?.home)}-${slug(a.match?.away)}.json`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(slim, null, 2) + "\n");
console.log(`Exported ${a.winners?.length ?? 0} winners -> ${path.relative(process.cwd(), outPath)}`);
