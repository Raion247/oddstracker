import Link from "next/link";
import { notFound } from "next/navigation";
import MarketsTable, { type MarketRow } from "@/C/MarketsTable";
import OddsTimeline, { type TimelinePoint } from "@/C/OddsTimeline";
import { matchClockMoment, type MatchClock } from "@/gameClock";
import { getEvent, getMarketNameByCode, getOddsHistory } from "@db/store";
import type { OddsHistoryRow, OddsRow } from "@db/types";
import { panelClass, sectionTitleClass } from "@/styles";

export const dynamic = "force-dynamic";

const displayStake = 10;
const kickoffGraceMilliseconds = 30000;

type MarketPeak = {
  marketCode: string;
  selectionName: string;
  bookmaker: string;
  line: number;
  odds: number;
  time: number | null;
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = getEvent(Number(eventId));
  if (!event) notFound();

  const kickoffSource = event.kickoffAt ?? event.startsAt;
  const clock: MatchClock | null = kickoffSource
    ? {
        kickoff: new Date(kickoffSource).getTime(),
        firstHalfEnd: toMilliseconds(event.firstHalfEndedAt),
        secondHalfStart: toMilliseconds(event.secondHalfStartedAt),
        fullTime: toMilliseconds(event.fullTimeAt),
      }
    : null;
  const historyRows = getOddsHistory(event.id);

  const marketNameByCode = getMarketNameByCode();
  const marketName = (code: string) => marketNameByCode.get(code) ?? code;

  const marketPeaks = computeMarketPeaks(historyRows, event.odds);
  const highestOverall = marketPeaks[0];
  const highestPeakMoment = highestOverall
    ? peakMomentLabel(highestOverall.time, clock)
    : "—";
  const highestPeakWasInMatch = highestPeakMoment !== "pre-match" && highestPeakMoment !== "—";
  const timelinePoints = clock ? pickInMatchPeaks(marketPeaks, clock, marketName) : [];
  const marketRows = buildMarketRows(marketPeaks, historyRows, event.odds, clock, marketName);

  return (
    <div>
      <Link href="/" className="mb-4 inline-block text-sm text-muted hover:text-white">
        &larr; Back to dashboard
      </Link>

      <h1 className="text-[1.7rem] font-bold">
        {event.homeTeam} - {event.awayTeam}
      </h1>
      <p className="mt-1 text-muted">
        {event.league ?? "Unknown league"}
        {event.startsAt ? ` · ${new Date(event.startsAt).toLocaleString("fi-FI")}` : ""}
        {` · source: ${event.source}`}
      </p>

      {!highestOverall ? (
        <p className="text-muted">No odds stored for this match.</p>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-2.5 rounded-lg border border-navy-border border-t-4 border-t-brand-green bg-gradient-to-br from-navy-light to-navy-deep px-6 py-9 text-center">
          <span className="text-[0.85rem] font-bold uppercase tracking-[0.12em] text-muted">
            Highest winning odds
          </span>
          <span className="text-[4.8rem] leading-none font-black text-gold [text-shadow:0_4px_24px_rgba(255,199,44,0.25)]">
            {highestOverall.odds.toFixed(2)}
          </span>
          <span className="text-[1.05rem]">
            {highestOverall.selectionName} —{" "}
            <span className="text-white">
              {marketName(highestOverall.marketCode)}
              {highestOverall.line !== 0 ? ` ${highestOverall.line}` : ""}
            </span>{" "}
            · {highestOverall.bookmaker}
          </span>
          <span className="mt-1.5 rounded-full bg-brand-green px-5 py-2 font-extrabold text-navy-deep">
            {displayStake.toFixed(0)} € would have paid{" "}
            {(highestOverall.odds * displayStake).toFixed(2)} €
            {highestPeakWasInMatch ? ` — betting at ${highestPeakMoment} into the game` : ""}
          </span>
        </div>
      )}

      <h2 className={sectionTitleClass}>Peak odds on the match clock</h2>
      <p className="text-muted">
        Only markets whose highest odds appeared during the match. Markets that peaked pre-match
        are listed in the table below but not stamped here.
      </p>
      <div className={`mt-3 ${panelClass}`}>
        {clock === null ? (
          <p className="text-muted">This match has no kickoff time, so game time is unknown.</p>
        ) : (
          <OddsTimeline points={timelinePoints} />
        )}
      </div>

      <h2 className={sectionTitleClass}>All markets</h2>
      <p className="mb-3 text-muted">
        The highest odds recorded for each market, best first. Click a market to see every
        bookmaker&apos;s best price on it.
      </p>
      <MarketsTable rows={marketRows} />
    </div>
  );
}

// One entry per market: its all-time highest odds and the moment they
// appeared. History rows are ordered by time, so the first occurrence of
// the highest value wins. Falls back to the latest odds if a market has
// no history rows.
function computeMarketPeaks(historyRows: OddsHistoryRow[], oddsRows: OddsRow[]): MarketPeak[] {
  const peakByMarket = new Map<string, MarketPeak>();

  for (const row of historyRows) {
    const currentPeak = peakByMarket.get(row.marketCode);
    if (!currentPeak || row.decimalOdds > currentPeak.odds) {
      peakByMarket.set(row.marketCode, {
        marketCode: row.marketCode,
        selectionName: row.selectionName,
        bookmaker: row.bookmaker,
        line: row.line,
        odds: row.decimalOdds,
        time: new Date(row.recordedAt).getTime(),
      });
    }
  }

  for (const row of oddsRows) {
    const currentPeak = peakByMarket.get(row.marketCode);
    if (!currentPeak || row.decimalOdds > currentPeak.odds) {
      peakByMarket.set(row.marketCode, {
        marketCode: row.marketCode,
        selectionName: row.selectionName,
        bookmaker: row.bookmaker,
        line: row.line,
        odds: row.decimalOdds,
        time: null,
      });
    }
  }

  return [...peakByMarket.values()].sort((peakA, peakB) => peakB.odds - peakA.odds);
}

// Markets whose peak happened during the match, as timeline stamps.
function pickInMatchPeaks(
  marketPeaks: MarketPeak[],
  clock: MatchClock,
  marketName: (code: string) => string
): TimelinePoint[] {
  const points: TimelinePoint[] = [];

  for (const peak of marketPeaks) {
    if (peak.time === null || peak.time <= clock.kickoff + kickoffGraceMilliseconds) continue;

    const moment = matchClockMoment(peak.time, clock);
    points.push({
      time: peak.time,
      odds: peak.odds,
      marketCode: peak.marketCode,
      marketName: marketName(peak.marketCode),
      selectionName: peak.selectionName,
      bookmaker: peak.bookmaker,
      positionMinutes: moment.positionMinutes,
      clockLabel: moment.label,
    });
  }

  return points;
}

// Table rows for the client component: the overall peak per market plus
// each bookmaker's own peak for the expanded view.
function buildMarketRows(
  marketPeaks: MarketPeak[],
  historyRows: OddsHistoryRow[],
  oddsRows: OddsRow[],
  clock: MatchClock | null,
  marketName: (code: string) => string
): MarketRow[] {
  const peakByMarketAndBookmaker = new Map<string, MarketPeak>();

  for (const row of historyRows) {
    const key = `${row.marketCode}|${row.bookmaker}`;
    const currentPeak = peakByMarketAndBookmaker.get(key);
    if (!currentPeak || row.decimalOdds > currentPeak.odds) {
      peakByMarketAndBookmaker.set(key, {
        marketCode: row.marketCode,
        selectionName: row.selectionName,
        bookmaker: row.bookmaker,
        line: row.line,
        odds: row.decimalOdds,
        time: new Date(row.recordedAt).getTime(),
      });
    }
  }

  for (const row of oddsRows) {
    const key = `${row.marketCode}|${row.bookmaker}`;
    const currentPeak = peakByMarketAndBookmaker.get(key);
    if (!currentPeak || row.decimalOdds > currentPeak.odds) {
      peakByMarketAndBookmaker.set(key, {
        marketCode: row.marketCode,
        selectionName: row.selectionName,
        bookmaker: row.bookmaker,
        line: row.line,
        odds: row.decimalOdds,
        time: null,
      });
    }
  }

  return marketPeaks.map((overallPeak) => ({
    marketCode: overallPeak.marketCode,
    marketName: marketName(overallPeak.marketCode),
    selectionName: overallPeak.selectionName,
    bookmaker: overallPeak.bookmaker,
    line: overallPeak.line,
    odds: overallPeak.odds,
    whenLabel: peakMomentLabel(overallPeak.time, clock),
    bookmakerPeaks: [...peakByMarketAndBookmaker.values()]
      .filter((peak) => peak.marketCode === overallPeak.marketCode)
      .sort((peakA, peakB) => peakB.odds - peakA.odds)
      .map((peak) => ({
        bookmaker: peak.bookmaker,
        selectionName: peak.selectionName,
        line: peak.line,
        odds: peak.odds,
        whenLabel: peakMomentLabel(peak.time, clock),
      })),
  }));
}

function peakMomentLabel(peakTime: number | null, clock: MatchClock | null): string {
  if (peakTime === null || clock === null) return "—";
  if (peakTime <= clock.kickoff + kickoffGraceMilliseconds) return "pre-match";
  return matchClockMoment(peakTime, clock).label;
}

function toMilliseconds(isoTime: string | null): number | null {
  return isoTime ? new Date(isoTime).getTime() : null;
}
