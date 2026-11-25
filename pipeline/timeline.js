#!/usr/bin/env node
/**
 * timeline.js - visual price timeline for ONE outcome across the match.
 *
 * Renders an SVG: pre-match band, then match-time zones (1st half, its stoppage,
 * 2nd half, its stoppage, and - only if the match ran long - extra-time halves and
 * their stoppages), with the peak price plotted per zone and the full price line.
 *
 * Usage:
 *   node timeline.js <fixtureId> <marketId> <outcomeId> [outfile.svg]
 *
 * Example (France win, FT result, home outcome):
 *   node timeline.js id10000... 101 101
 *
 * Reads only local data/ files. Writes data/<fixtureId>/timeline.<market>.<outcome>.svg
 * (or the outfile you pass) and prints the path.
 */

const fs = require("fs");
const path = require("path");

const [fixtureId, marketId, outcomeId, outArg] = process.argv.slice(2);
if (!fixtureId || !marketId || !outcomeId) {
  console.error("Usage: node timeline.js <fixtureId> <marketId> <outcomeId> [outfile.svg]");
  process.exit(1);
}

const dir = path.join(__dirname, "data", fixtureId);
const load = (f) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };

const fixture = load("fixture.json");
const scores = load("scores.json");
if (!fixture) { console.error("No fixture.json - fetch the match first."); process.exit(1); }

// --- gather snapshots for this outcome across all books ---
const snaps = []; // {t: Date, price, book}
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("historical.") && f.endsWith(".json"))) {
  const data = load(f);
  for (const [book, bo] of Object.entries(data?.bookmakers ?? {})) {
    const list = bo.markets?.[marketId]?.outcomes?.[outcomeId]?.players?.["0"];
    if (Array.isArray(list)) for (const s of list) if (s.price != null) snaps.push({ t: new Date(s.createdAt), price: s.price, book });
  }
}
if (!snaps.length) { console.error(`No snapshots for market ${marketId} outcome ${outcomeId}.`); process.exit(1); }
snaps.sort((a, b) => a.t - b.t);

// --- market/outcome names for the title ---
let marketName = `market ${marketId}`, outcomeName = `outcome ${outcomeId}`;
const ref = (() => { const p = path.join(__dirname, "data", "markets.json"); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; })();
if (Array.isArray(ref)) {
  const m = ref.find((x) => String(x.marketId) === String(marketId));
  if (m) { marketName = m.marketName ?? marketName; const o = (m.outcomes ?? []).find((x) => String(x.outcomeId) === String(outcomeId)); if (o) outcomeName = o.outcomeName ?? outcomeName; }
}

// --- kickoff + match length from scores periods ---
const KO = new Date(fixture.trueStartTime ?? fixture.startTime);
const periods = scores?.scores?.periods ?? {};
// detect whether extra time happened: presence of ot/ap periods or a very long timeline
const hasET = !!(periods.ot || periods.ap || periods.et || periods.overtime);
// robust "last real minute": use period updatedAt if present, else the last snapshot
// that isn't an isolated post-match straggler (>10min gap from the previous one)
function lastRealMin() {
  const upd = Object.values(periods).map((p) => p?.updatedAt ? new Date(p.updatedAt).getTime() : null).filter(Boolean);
  if (upd.length) return (Math.max(...upd) - KO.getTime()) / 60000;
  let end = snaps[0].t;
  for (let i = 1; i < snaps.length; i++) {
    const minSinceKO = (snaps[i - 1].t - KO) / 60000;
    // only treat a big gap as match-end once we're past ~95' (avoids early in-play gaps)
    if (minSinceKO > 95 && (snaps[i].t - snaps[i - 1].t) / 60000 > 10) break;
    end = snaps[i].t;
  }
  return (end - KO) / 60000;
}
const lastSnapMin = lastRealMin();

/**
 * Piecewise map: wall-clock minutes since kickoff -> x fraction [0,1] across the
 * match portion of the axis. Zones get fixed widths; stoppage compresses.
 * Real elapsed assumptions: 1H 0-45, HT break ~15 real min, 2H starts ~60 real
 * min after KO. We detect the 2H start by the largest gap in snapshots near HT.
 */
function buildZones() {
  // zones: {key,label,startMin,endMin (wall-clock min since KO), w (weight)}
  // weights set relative visual width; stoppage zones are narrow.
  const z = [];
  z.push({ key: "1h", label: "1st Half", a: 0, b: 45, w: 45 });
  // 45+ absorbs first-half stoppage AND the halftime break (up to 2H kickoff ~60')
  z.push({ key: "1h+", label: "45+ / HT", a: 45, b: 60, w: 8 });
  z.push({ key: "2h", label: "2nd Half", a: 60, b: 105, w: 45 });
  z.push({ key: "2h+", label: "90+", a: 105, b: 120, w: 10 });
  if (hasET || lastSnapMin > 122) {
    z.push({ key: "et1", label: "ET 1", a: 120, b: 135, w: 15 });
    z.push({ key: "et1+", label: "105+", a: 135, b: 138, w: 4 });
    z.push({ key: "et2", label: "ET 2", a: 138, b: 153, w: 15 });
    z.push({ key: "et2+", label: "120+", a: 153, b: 160, w: 5 });
  }
  // normalize weights -> cumulative x fractions
  const total = z.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of z) { x.x0 = acc / total; acc += x.w; x.x1 = acc / total; }
  return z;
}
const zones = buildZones();

function wallMinToX(min) {
  if (min <= 0) return 0;
  for (const z of zones) if (min >= z.a && min <= z.b) return z.x0 + ((min - z.a) / (z.b - z.a)) * (z.x1 - z.x0);
  // between zones (e.g. halftime break) -> clamp to zone edge
  for (let i = 0; i < zones.length - 1; i++) if (min > zones[i].b && min < zones[i + 1].a) return zones[i].x1;
  return min < zones[0].a ? 0 : 1;
}

// classify snapshots: pre-match vs in-play, dropping post-match stale quotes
const KO_ms = KO.getTime();
// match end: last period's updatedAt, or fall back to last snapshot within a sane window
const endCandidates = Object.values(periods).map((p) => p?.updatedAt ? new Date(p.updatedAt).getTime() : null).filter(Boolean);
// end = period updatedAt if available, else kickoff + lastRealMin (gap-detected)
const matchEnd = endCandidates.length ? Math.max(...endCandidates) : KO.getTime() + lastSnapMin * 60000;
const endCutoff = matchEnd + 3 * 60000; // +3min buffer

const pre = snaps.filter((s) => s.t < KO);
const live = snaps.filter((s) => s.t >= KO && (!endCutoff || s.t.getTime() <= endCutoff));
const preMax = pre.reduce((mx, s) => (s.price > (mx?.price ?? -1) ? s : mx), null);

// per-zone peak
for (const z of zones) {
  z.peak = null;
  for (const s of live) {
    const min = (s.t - KO) / 60000;
    if (min >= z.a && min <= z.b && s.price > (z.peak?.price ?? -1)) z.peak = s;
  }
}

// --- SVG geometry ---
const W = 900, H = 420, padL = 56, padR = 20, padT = 40, padB = 60;
const preW = 90; // pre-match band width in px
const plotX0 = padL + preW, plotX1 = W - padR, plotW = plotX1 - plotX0;
const plotY0 = padT, plotY1 = H - padB, plotH = plotY1 - plotY0;

const allPrices = snaps.map((s) => s.price);
const maxP = Math.max(...allPrices), minP = Math.min(...allPrices);
// log scale (odds span 1x..500x); guard against <=0
const lg = (p) => Math.log(Math.max(p, 1.01));
const yOf = (p) => plotY1 - ((lg(p) - lg(minP)) / (lg(maxP) - lg(minP) || 1)) * plotH;
const xOfLive = (s) => plotX0 + wallMinToX((s.t - KO) / 60000) * plotW;
const xOfPre = (s, i, n) => padL + (n <= 1 ? preW / 2 : (i / (n - 1)) * preW * 0.8 + preW * 0.1);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (p) => (p % 1 === 0 ? p + "x" : p.toFixed(2).replace(/\.?0+$/, "") + "x");

let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'IBM Plex Mono',monospace">
<rect width="${W}" height="${H}" fill="#101418"/>
<text x="${padL}" y="24" fill="#dfe6ec" font-size="16" font-family="'Barlow Condensed',sans-serif" font-weight="600">${esc(fixture.participant1Name)} vs ${esc(fixture.participant2Name)} — ${esc(marketName)}: ${esc(outcomeName)}</text>`;

// y gridlines at nice odds values
const ticks = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500].filter((v) => v >= minP * 0.9 && v <= maxP * 1.1);
for (const v of ticks) {
  const y = yOf(v);
  svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${plotX1}" y2="${y.toFixed(1)}" stroke="#2a333d" stroke-width="1"/>`;
  svg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" fill="#8b98a5" font-size="11" text-anchor="end">${fmt(v)}</text>`;
}

// pre-match band background
svg += `<rect x="${padL}" y="${plotY0}" width="${preW}" height="${plotH}" fill="#151b21"/>
<text x="${padL + preW / 2}" y="${plotY1 + 16}" fill="#8b98a5" font-size="10" text-anchor="middle">PRE-MATCH</text>
<line x1="${plotX0}" y1="${plotY0}" x2="${plotX0}" y2="${plotY1}" stroke="#3a4a58" stroke-width="1" stroke-dasharray="3 3"/>`;

// zone backgrounds + labels (alternate shading; stoppage zones amber-tinted)
for (const z of zones) {
  const zx0 = plotX0 + z.x0 * plotW, zx1 = plotX0 + z.x1 * plotW;
  const isStop = z.key.includes("+");
  const fill = isStop ? "#1a1c18" : (["1h", "et1"].includes(z.key) ? "#141a20" : "#171d24");
  svg += `<rect x="${zx0.toFixed(1)}" y="${plotY0}" width="${(zx1 - zx0).toFixed(1)}" height="${plotH}" fill="${fill}"/>`;
  if (isStop) svg += `<rect x="${zx0.toFixed(1)}" y="${plotY0}" width="${(zx1 - zx0).toFixed(1)}" height="${plotH}" fill="#f5b942" opacity="0.05"/>`;
  svg += `<text x="${((zx0 + zx1) / 2).toFixed(1)}" y="${plotY1 + 16}" fill="${isStop ? "#c8962f" : "#8b98a5"}" font-size="10" text-anchor="middle">${esc(z.label)}</text>`;
  // separator line between halves (thicker before 2H and ET)
  if (["2h", "et1"].includes(z.key)) svg += `<line x1="${zx0.toFixed(1)}" y1="${plotY0 - 6}" x2="${zx0.toFixed(1)}" y2="${plotY1}" stroke="#3a4a58" stroke-width="1.5"/>`;
}

// price line (pre-match then live), split by book color
const bookColor = { stake: "#8ab4f8", "1xbet": "#57c98a", bet365: "#f5b942", pinnacle: "#e06c5f", default: "#8b98a5" };
// build ordered points
const prePts = pre.map((s, i) => ({ x: xOfPre(s, i, pre.length), y: yOf(s.price), s }));
const livePts = live.map((s) => ({ x: xOfLive(s), y: yOf(s.price), s }));
const linePts = [...prePts, ...livePts];
if (linePts.length > 1) {
  svg += `<polyline fill="none" stroke="#3a4a58" stroke-width="1.5" points="${linePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`;
}
// dots colored by book
for (const p of linePts) {
  const c = bookColor[p.s.book] ?? bookColor.default;
  svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.6" fill="${c}" opacity="0.7"/>`;
}

// pre-match peak marker
if (preMax) {
  const x = padL + preW / 2, y = yOf(preMax.price);
  svg += `<circle cx="${x}" cy="${y.toFixed(1)}" r="4" fill="#dfe6ec"/><text x="${x}" y="${(y - 8).toFixed(1)}" fill="#dfe6ec" font-size="11" text-anchor="middle">${fmt(preMax.price)}</text>`;
}
// per-zone peak markers
for (const z of zones) {
  if (!z.peak) continue;
  const x = xOfLive(z.peak), y = yOf(z.peak.price);
  svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#f5b942"/>`;
  svg += `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" fill="#f5b942" font-size="11" text-anchor="middle" font-weight="600">${fmt(z.peak.price)}</text>`;
}

// legend
const books = [...new Set(snaps.map((s) => s.book))];
let lx = plotX0;
for (const b of books) {
  svg += `<circle cx="${lx}" cy="${H - 12}" r="3" fill="${bookColor[b] ?? bookColor.default}"/><text x="${lx + 7}" y="${H - 8}" fill="#8b98a5" font-size="10">${esc(b)}</text>`;
  lx += 20 + b.length * 6.5;
}
svg += `<text x="${plotX1}" y="${H - 8}" fill="#8b98a5" font-size="10" text-anchor="end">amber = zone peak · white = pre-match peak</text>`;
svg += `</svg>`;

const outPath = outArg ? path.resolve(outArg) : path.join(dir, `timeline.${marketId}.${outcomeId}.svg`);
fs.writeFileSync(outPath, svg);
console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`\nPre-match peak: ${preMax ? fmt(preMax.price) : "—"}`);
for (const z of zones) if (z.peak) console.log(`  ${z.label.padEnd(10)} peak ${fmt(z.peak.price).padStart(7)}  @ ${z.peak.book}  ${z.peak.t.toISOString().slice(11, 19)}`);
console.log(`\nExtra time zones: ${hasET || lastSnapMin > 118 ? "shown" : "hidden (match ended in regulation)"}`);