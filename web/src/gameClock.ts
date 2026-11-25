// Turns a wall-clock moment into a game clock label ("34'", "45+2", "90+6")
// and a position on the timeline. Uses the match's real period times when
// they are known, and falls back to typical stoppage and break lengths.

export type MatchClock = {
  kickoff: number;
  firstHalfEnd: number | null;
  secondHalfStart: number | null;
  fullTime: number | null;
}

export type ClockMoment = {
  label: string;
  // Minutes in the timeline's coordinate space: first half 0-45,
  // 45+ zone 45-60, second half 60-105, 90+ zone 105-120.
  positionMinutes: number;
}

export function matchClockMoment(time: number, clock: MatchClock): ClockMoment {
  const minutesSinceKickoff = (time - clock.kickoff) / 60000;

  // Without the real second half start, fall back to assumed timings.
  if (clock.secondHalfStart === null) {
    return assumedClockMoment(minutesSinceKickoff);
  }

  const firstHalfEnd = clock.firstHalfEnd ?? clock.kickoff + 45 * 60000;

  if (time <= firstHalfEnd) {
    const minute = Math.round(minutesSinceKickoff);
    if (minute <= 45) return { label: `${minute}'`, positionMinutes: minutesSinceKickoff };
    return { label: `45+${minute - 45}`, positionMinutes: Math.min(minutesSinceKickoff, 59.9) };
  }

  if (time < clock.secondHalfStart) {
    // Half time break.
    return { label: "HT", positionMinutes: 57 };
  }

  const gameMinute = 45 + (time - clock.secondHalfStart) / 60000;
  if (gameMinute <= 90) {
    return { label: `${Math.round(gameMinute)}'`, positionMinutes: 60 + (gameMinute - 45) };
  }

  const overtimeMinutes = gameMinute - 90;
  return {
    label: `90+${Math.round(overtimeMinutes)}`,
    positionMinutes: Math.min(105 + overtimeMinutes, 119.9),
  };
}

function assumedClockMoment(minutesSinceKickoff: number): ClockMoment {
  const minutes = Math.round(minutesSinceKickoff);
  const position = Math.min(minutesSinceKickoff, 119.9);

  if (minutes <= 45) return { label: `${minutes}'`, positionMinutes: position };
  if (minutes <= 60) return { label: `45+${minutes - 45}`, positionMinutes: position };
  if (minutes <= 105) return { label: `${minutes - 15}'`, positionMinutes: position };
  return { label: `90+${minutes - 105}`, positionMinutes: position };
}
