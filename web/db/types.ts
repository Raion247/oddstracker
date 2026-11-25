export type MarketDefinition = {
  code: string;
  displayName: string;
  externalIds: string[]; // the source's raw market ids that map to this code
  matchCount: number; // how many analyzed matches contained this market
}

export type SportEvent = {
  id: number;
  source: string;
  externalEventId: string;
  sport: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  startsAt: string | null;
  kickoffAt: string | null;
  firstHalfEndedAt: string | null;
  secondHalfStartedAt: string | null;
  fullTimeAt: string | null;
}

export type OddsRow = {
  id: number;
  eventId: number;
  marketCode: string;
  selectionName: string;
  line: number;
  decimalOdds: number;
  bookmaker: string;
}

export interface EventWithOdds extends SportEvent {
  odds: OddsRow[];
}

export type OddsHistoryRow = {
  marketCode: string;
  selectionName: string;
  line: number;
  decimalOdds: number;
  bookmaker: string;
  recordedAt: string;
}
