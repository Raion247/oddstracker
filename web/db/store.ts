import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventWithOdds, MarketDefinition, OddsHistoryRow, OddsRow } from "./types";

// The whole data store: every analysis JSON in db/odds-samples, loaded
// and normalized in memory. No database needed — drop a new file in the
// folder and restart the dev server to add a match.

const dataFolder = join(process.cwd(), "db", "odds-samples");

type Store = {
  events: EventWithOdds[];
  historyByEventId: Map<number, OddsHistoryRow[]>;
  marketDefinitions: MarketDefinition[];
}

let cachedStore: Store | null = null;

function getStore(): Store {
  if (!cachedStore) cachedStore = buildStore();
  return cachedStore;
}

export function getEvents(): EventWithOdds[] {
  return getStore().events;
}

export function getEvent(eventId: number): EventWithOdds | null {
  return getStore().events.find((event) => event.id === eventId) ?? null;
}

export function getOddsHistory(eventId: number): OddsHistoryRow[] {
  return getStore().historyByEventId.get(eventId) ?? [];
}

export function getMarketDefinitions(): MarketDefinition[] {
  return getStore().marketDefinitions;
}

// code -> human readable market name, for showing names instead of codes.
export function getMarketNameByCode(): Map<string, string> {
  return new Map(getStore().marketDefinitions.map((market) => [market.code, market.displayName]));
}

// ---------- analysis file shape ----------

type PriceSnapshot = {
  price: number;
  at: string;
}

type AnalysisWinner = {
  marketId: string | number;
  marketName?: string;
  canonical?: string | null;
  line?: string;
  outcomeName: string;
  perBook?: Record<string, { open?: PriceSnapshot; peak?: PriceSnapshot; close?: PriceSnapshot }>;
}

type AnalysisFile = {
  fixtureId: string;
  match?: {
    home: string;
    away: string;
    startTime?: string;
    tournament?: string;
  };
  scores?: {
    scores?: { periods?: Record<string, { startedAt?: string; updatedAt?: string }> };
  };
  winners: AnalysisWinner[];
}

// ---------- loading ----------

type DefinitionAccumulator = {
  displayName: string;
  externalIds: Set<string>;
  eventIds: Set<number>;
};

function buildStore(): Store {
  const events: EventWithOdds[] = [];
  const historyByEventId = new Map<number, OddsHistoryRow[]>();
  const definitionsByCode = new Map<string, DefinitionAccumulator>();
  const seenFixtureIds = new Set<string>();

  const fileNames = readdirSync(dataFolder)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  let nextOddsId = 1;

  for (const fileName of fileNames) {
    let file: AnalysisFile;
    try {
      file = JSON.parse(readFileSync(join(dataFolder, fileName), "utf8"));
    } catch {
      console.warn(`Skipping ${fileName}: not valid JSON (truncated file?)`);
      continue;
    }
    if (!file.fixtureId || !file.match || !Array.isArray(file.winners)) continue;
    if (seenFixtureIds.has(file.fixtureId)) continue; // duplicate file, skip
    seenFixtureIds.add(file.fixtureId);

    const eventId = events.length + 1;
    const periods = extractPeriods(file);
    const oddsRows: OddsRow[] = [];
    const historyRows: OddsHistoryRow[] = [];

    for (const winner of file.winners) {
      const marketCode = canonicalMarketCode(winner);
      const line = Number(winner.line ?? 0) || 0;

      const definition = definitionsByCode.get(marketCode) ?? {
        displayName: winner.marketName ?? marketCode,
        externalIds: new Set<string>(),
        eventIds: new Set<number>(),
      };
      definition.externalIds.add(String(winner.marketId));
      definition.eventIds.add(eventId);
      definitionsByCode.set(marketCode, definition);

      for (const [bookmaker, series] of Object.entries(winner.perBook ?? {})) {
        const snapshots = collectSnapshots(series);
        if (snapshots.length === 0) continue;

        oddsRows.push({
          id: nextOddsId++,
          eventId,
          marketCode,
          selectionName: winner.outcomeName,
          line,
          decimalOdds: Math.max(...snapshots.map((snapshot) => snapshot.odds)),
          bookmaker,
        });

        for (const snapshot of snapshots) {
          historyRows.push({
            marketCode,
            selectionName: winner.outcomeName,
            line,
            decimalOdds: snapshot.odds,
            bookmaker,
            recordedAt: snapshot.recordedAt,
          });
        }
      }
    }

    historyRows.sort(
      (rowA, rowB) => new Date(rowA.recordedAt).getTime() - new Date(rowB.recordedAt).getTime()
    );

    events.push({
      id: eventId,
      source: "oddspapi",
      externalEventId: file.fixtureId,
      sport: "football",
      league: file.match.tournament ?? null,
      homeTeam: file.match.home,
      awayTeam: file.match.away,
      startsAt: file.match.startTime ?? null,
      ...periods,
      odds: oddsRows,
    });
    historyByEventId.set(eventId, historyRows);
  }

  events.sort((eventA, eventB) =>
    (eventA.startsAt ?? "").localeCompare(eventB.startsAt ?? "")
  );

  const marketDefinitions: MarketDefinition[] = [...definitionsByCode.entries()]
    .map(([code, accumulator]) => ({
      code,
      displayName: accumulator.displayName,
      externalIds: [...accumulator.externalIds].sort((idA, idB) => Number(idA) - Number(idB)),
      matchCount: accumulator.eventIds.size,
    }))
    .sort((definitionA, definitionB) => definitionA.displayName.localeCompare(definitionB.displayName));

  return { events, historyByEventId, marketDefinitions };
}

// One vocabulary for every file, whether it was exported with canonical
// tagging or not. The market name exists in all files, so it decides first;
// the canonical field and the raw id are fallbacks.
const canonicalByMarketName: Record<string, string> = {
  "full time result": "FULL_TIME_RESULT",
  "first half result": "FIRST_HALF_RESULT",
  "second half result": "SECOND_HALF_RESULT",
  "double chance": "DOUBLE_CHANCE",
  "double chance full time": "DOUBLE_CHANCE",
  "double chance first half": "DOUBLE_CHANCE_1H",
  "draw no bet": "DRAW_NO_BET",
  "draw no bet first half": "DRAW_NO_BET_1H",
  "correct score": "CORRECT_SCORE_FT",
  "correct score full time": "CORRECT_SCORE_FT",
  "exact score": "CORRECT_SCORE_FT",
  "correct score first half": "CORRECT_SCORE_1H",
  "correct score second half": "CORRECT_SCORE_2H",
  "over under full time": "OVER_UNDER_FT",
  "over under first half": "OVER_UNDER_1H",
  "over under second half": "OVER_UNDER_2H",
  "over under team 1": "OVER_UNDER_TEAM1",
  "over under team 2": "OVER_UNDER_TEAM2",
  "over under team 1 first half": "OVER_UNDER_TEAM1_1H",
  "over under team 2 first half": "OVER_UNDER_TEAM2_1H",
  "asian handicap": "ASIAN_HANDICAP",
  "asian handicap first half": "ASIAN_HANDICAP_1H",
  "asian handicap second half": "ASIAN_HANDICAP_2H",
  "european handicap": "EUROPEAN_HANDICAP",
  "european handicap first half": "EUROPEAN_HANDICAP_1H",
  "winner (incl. overtime)": "WINNER_INCL_OVERTIME",
};

function canonicalMarketCode(winner: AnalysisWinner): string {
  const marketName = winner.marketName?.trim().toLowerCase();
  if (marketName && canonicalByMarketName[marketName]) return canonicalByMarketName[marketName];
  if (winner.canonical) return winner.canonical;
  if (marketName) {
    const slug = marketName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (slug.length > 0) return slug;
  }
  return String(winner.marketId);
}

// Real period times from the score data. "result" starts at kickoff,
// p1.updatedAt is the last first half score update and p1.startedAt is
// when the second half kicked off.
function extractPeriods(file: AnalysisFile) {
  const periods = file.scores?.scores?.periods ?? {};

  const kickoffAt = periods.result?.startedAt ?? file.match?.startTime ?? null;
  const firstHalfEndedAt = periods.p1?.updatedAt ?? null;
  const secondHalfStartedAt = periods.p1?.startedAt ?? null;
  const fullTimeAt = periods.fulltime?.startedAt ?? null;

  const secondHalfIsValid =
    secondHalfStartedAt &&
    (!firstHalfEndedAt || new Date(secondHalfStartedAt) > new Date(firstHalfEndedAt));

  return {
    kickoffAt,
    firstHalfEndedAt,
    secondHalfStartedAt: secondHalfIsValid ? secondHalfStartedAt : null,
    fullTimeAt,
  };
}

function collectSnapshots(series: {
  open?: PriceSnapshot;
  peak?: PriceSnapshot;
  close?: PriceSnapshot;
}): { odds: number; recordedAt: string }[] {
  const seenTimes = new Set<string>();
  const snapshots: { odds: number; recordedAt: string }[] = [];

  for (const snapshot of [series.open, series.peak, series.close]) {
    if (!snapshot || !snapshot.price || seenTimes.has(snapshot.at)) continue;
    seenTimes.add(snapshot.at);
    snapshots.push({ odds: snapshot.price, recordedAt: snapshot.at });
  }

  return snapshots.sort(
    (snapshotA, snapshotB) =>
      new Date(snapshotA.recordedAt).getTime() - new Date(snapshotB.recordedAt).getTime()
  );
}
