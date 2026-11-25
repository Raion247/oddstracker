import Link from "next/link";
import { getEvents, getMarketDefinitions } from "@db/store";
import {
  pageTitleClass,
  sectionTitleClass,
  tableCellClass,
  tableClass,
  tableHeaderCellClass,
} from "@/styles";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const events = getEvents();
  const definitions = getMarketDefinitions();
  const totalOddsCount = events.reduce(
    (sum, event) => sum + event.odds.length,
    0,
  );

  return (
    <div>
      <h1 className={pageTitleClass}>Dashboard</h1>

      <div className="flex flex-wrap gap-4">
        <StatCard number={events.length} label="Analyzed matches" />
        <StatCard number={totalOddsCount} label="Odds stored" />
        <StatCard number={definitions.length} label="Markets in library" />
      </div>

      <h2 className={sectionTitleClass}>Matches</h2>

      {events.length === 0 ? (
        <p className="text-muted">
          No matches yet. Drop analysis JSON files into{" "}
          <code>db/odds-samples/</code> and restart the dev server.
        </p>
      ) : (
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={tableHeaderCellClass}>Match</th>
              <th className={tableHeaderCellClass}>League</th>
              <th className={tableHeaderCellClass}>Played</th>
              <th className={tableHeaderCellClass}>Source</th>
              <th className={tableHeaderCellClass}>Odds</th>
              <th className={tableHeaderCellClass}>Highest odds</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const highestOdds = event.odds.reduce(
                (max, oddsRow) => Math.max(max, oddsRow.decimalOdds),
                0,
              );

              return (
                <tr key={event.id}>
                  <td className={tableCellClass}>
                    <Link
                      href={`/events/${event.id}`}
                      className="underline text-gold"
                    >
                      {event.homeTeam} - {event.awayTeam}
                    </Link>
                  </td>
                  <td className={tableCellClass}>{event.league ?? "-"}</td>
                  <td className={tableCellClass}>
                    {event.startsAt
                      ? new Date(event.startsAt).toLocaleString("en-GB")
                      : "-"}
                  </td>
                  <td className={tableCellClass}>{event.source}</td>
                  <td className={tableCellClass}>{event.odds.length}</td>
                  <td className={`${tableCellClass} font-bold text-gold`}>
                    {highestOdds > 0 ? `${highestOdds.toFixed(2)}x` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ number, label }: { number: number; label: string }) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1 rounded-lg border border-navy-border bg-navy-light px-5 py-4 text-muted">
      <span className="text-[2rem] font-extrabold text-white">{number}</span>
      <span>{label}</span>
    </div>
  );
}
