export type TimelinePoint = {
  time: number;
  odds: number;
  marketCode: string;
  marketName: string;
  selectionName: string;
  bookmaker: string;
  positionMinutes: number;
  clockLabel: string;
}

type TimelineZone = {
  label: string;
  start: number; // minutes in the timeline coordinate space
  end: number;
  stoppage: boolean;
}

// The match clock as separate segments with gaps. Stoppage zones (45+, 90+)
// are dotted. Positions come from the game clock: first half 0-45, 45+ zone
// 45-60, second half 60-105, 90+ zone 105-120.
const regularZones: TimelineZone[] = [
  { label: "1st Half", start: 0, end: 45, stoppage: false },
  { label: "45+", start: 45, end: 60, stoppage: true },
  { label: "2nd Half", start: 60, end: 105, stoppage: false },
  { label: "90+", start: 105, end: 120, stoppage: true },
];

const extraTimeZones: TimelineZone[] = [
  { label: "ET 1", start: 120, end: 135, stoppage: false },
  { label: "105+", start: 135, end: 138, stoppage: true },
  { label: "ET 2", start: 138, end: 153, stoppage: false },
  { label: "120+", start: 153, end: 160, stoppage: true },
];

export default function OddsTimeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-muted">
        No in-match peaks to plot — every market hit its highest odds before kickoff.
      </p>
    );
  }

  const hasExtraTime = points.some((point) => point.positionMinutes > 120);
  const zones = hasExtraTime ? [...regularZones, ...extraTimeZones] : regularZones;
  const timelineEnd = zones[zones.length - 1].end;

  const width = 900;
  const height = 240;
  const paddingLeft = 20;
  const paddingRight = 20;
  const lineY = 130;
  const zoneGap = 14;

  // Give every zone a width proportional to its duration.
  const usableWidth = width - paddingLeft - paddingRight - zoneGap * (zones.length - 1);
  const totalMinutes = zones.reduce((sum, zone) => sum + (zone.end - zone.start), 0);

  const placedZones = zones.map((zone) => ({ ...zone, x0: 0, x1: 0 }));
  let cursorX = paddingLeft;
  for (const zone of placedZones) {
    const zoneWidth = ((zone.end - zone.start) / totalMinutes) * usableWidth;
    zone.x0 = cursorX;
    zone.x1 = cursorX + zoneWidth;
    cursorX = zone.x1 + zoneGap;
  }

  const xForMinute = (rawMinute: number): number => {
    const minute = Math.min(Math.max(rawMinute, 0), timelineEnd - 0.001);
    const zone =
      placedZones.find((z) => minute >= z.start && minute < z.end) ??
      placedZones[placedZones.length - 1];
    return zone.x0 + ((minute - zone.start) / (zone.end - zone.start)) * (zone.x1 - zone.x0);
  };

  // Sort by time, then nudge labels apart so they never overlap.
  const laidPoints = [...points]
    .sort((pointA, pointB) => pointA.time - pointB.time)
    .map((point) => ({ ...point, x: xForMinute(point.positionMinutes), labelX: 0 }));

  // Keep labels apart and fully inside the box. halfLabelWidth covers the
  // widest market code, since labels are centered on their anchor.
  const minimumLabelGap = 55;
  const halfLabelWidth = 52;
  const minimumLabelX = paddingLeft + halfLabelWidth;
  const maximumLabelX = width - paddingRight - halfLabelWidth;

  for (let index = 0; index < laidPoints.length; index++) {
    laidPoints[index].labelX = Math.max(laidPoints[index].x, minimumLabelX);
    if (index > 0 && laidPoints[index].labelX - laidPoints[index - 1].labelX < minimumLabelGap) {
      laidPoints[index].labelX = laidPoints[index - 1].labelX + minimumLabelGap;
    }
  }

  const overflow = laidPoints[laidPoints.length - 1].labelX - maximumLabelX;
  if (overflow > 0) {
    for (const point of laidPoints) point.labelX -= overflow;
  }

  // The shift back may have pushed early labels past the left edge.
  for (let index = 0; index < laidPoints.length; index++) {
    const lowestAllowed =
      index === 0 ? minimumLabelX : laidPoints[index - 1].labelX + minimumLabelGap;
    laidPoints[index].labelX = Math.max(laidPoints[index].labelX, lowestAllowed);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
      {/* zone segments and labels */}
      {placedZones.map((zone) => (
        <g key={zone.label}>
          <line
            x1={zone.x0}
            y1={lineY}
            x2={zone.x1}
            y2={lineY}
            stroke={zone.stoppage ? "#a9822f" : "#4a5f83"}
            strokeWidth={zone.stoppage ? 2 : 3}
            strokeDasharray={zone.stoppage ? "2 3" : undefined}
          />
          <line
            x1={zone.x0}
            y1={lineY - 5}
            x2={zone.x0}
            y2={lineY + 5}
            stroke={zone.stoppage ? "#a9822f" : "#4a5f83"}
            strokeWidth={1.5}
          />
          <text
            x={(zone.x0 + zone.x1) / 2}
            y={lineY + 26}
            textAnchor="middle"
            fill={zone.stoppage ? "#a9822f" : "#9db2ce"}
            fontSize={10}
          >
            {zone.label}
          </text>
        </g>
      ))}

      {/* peak stamps, labels alternating above and below the line */}
      {laidPoints.map((point, pointIndex) => {
        const isAbove = pointIndex % 2 === 0;
        const connectorEndY = isAbove ? lineY - 30 : lineY + 34;
        const oddsTextY = isAbove ? lineY - 34 : lineY + 48;
        const selectionTextY = isAbove ? lineY - 50 : lineY + 62;
        const marketTextY = isAbove ? lineY - 62 : lineY + 74;

        return (
          <g key={`${point.marketCode}-${point.time}`}>
            <title>
              {`${point.marketName} — ${point.selectionName} @ ${point.odds.toFixed(2)} (${point.bookmaker}, ${point.clockLabel})`}
            </title>
            <line x1={point.x} y1={lineY} x2={point.labelX} y2={connectorEndY} stroke="#24518f" />
            <circle cx={point.x} cy={lineY} r={5} fill="#ffc72c" />
            <text x={point.labelX} y={marketTextY} textAnchor="middle" fill="#9db2ce" fontSize={9}>
              {point.marketName}
            </text>
            <text x={point.labelX} y={selectionTextY} textAnchor="middle" fill="#dfe6ec" fontSize={10}>
              {point.selectionName} · {point.clockLabel}
            </text>
            <text
              x={point.labelX}
              y={oddsTextY}
              textAnchor="middle"
              fill="#ffc72c"
              fontSize={14}
              fontWeight={700}
            >
              {point.odds.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
