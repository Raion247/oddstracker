"use client";

import { useState } from "react";
import { tableCellClass, tableClass, tableHeaderCellClass } from "@/styles";

export type BookmakerPeak = {
  bookmaker: string;
  selectionName: string;
  line: number;
  odds: number;
  whenLabel: string;
}

export type MarketRow = {
  marketCode: string;
  marketName: string;
  selectionName: string;
  bookmaker: string;
  line: number;
  odds: number;
  whenLabel: string;
  bookmakerPeaks: BookmakerPeak[];
}

const bookmakerCellClass = `${tableCellClass} bg-[#0d2244] text-[0.88rem] text-muted`;

// The all markets table. Clicking a market expands it and shows the
// highest odds every bookmaker offered on that market.
export default function MarketsTable({ rows }: { rows: MarketRow[] }) {
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set());

  function toggleMarket(marketCode: string) {
    const expanded = new Set(expandedMarkets);
    if (expanded.has(marketCode)) {
      expanded.delete(marketCode);
    } else {
      expanded.add(marketCode);
    }
    setExpandedMarkets(expanded);
  }

  return (
    <table className={tableClass}>
      <thead>
        <tr>
          <th className={tableHeaderCellClass}>Market</th>
          <th className={tableHeaderCellClass}>Selection</th>
          <th className={tableHeaderCellClass}>Bookmaker</th>
          <th className={tableHeaderCellClass}>Odds</th>
          <th className={tableHeaderCellClass}>When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isExpanded = expandedMarkets.has(row.marketCode);

          return [
            <tr
              key={row.marketCode}
              className="cursor-pointer hover:bg-navy-lighter"
              onClick={() => toggleMarket(row.marketCode)}
            >
              <td className={tableCellClass}>
                <span className="mr-1 inline-block w-4 text-sm text-gold">
                  {isExpanded ? "▾" : "▸"}
                </span>
                {row.marketName}
                {row.line !== 0 ? ` ${row.line}` : ""}
              </td>
              <td className={tableCellClass}>{row.selectionName}</td>
              <td className={tableCellClass}>{row.bookmaker}</td>
              <td className={tableCellClass}>{row.odds.toFixed(2)}</td>
              <td className={tableCellClass}>{row.whenLabel}</td>
            </tr>,
            ...(isExpanded
              ? row.bookmakerPeaks.map((peak) => (
                  <tr key={`${row.marketCode}-${peak.bookmaker}`}>
                    <td className={bookmakerCellClass}>
                      <span className="pl-4">
                        {peak.line !== 0 ? `line ${peak.line}` : ""}
                      </span>
                    </td>
                    <td className={bookmakerCellClass}>{peak.selectionName}</td>
                    <td className={bookmakerCellClass}>{peak.bookmaker}</td>
                    <td className={bookmakerCellClass}>{peak.odds.toFixed(2)}</td>
                    <td className={bookmakerCellClass}>{peak.whenLabel}</td>
                  </tr>
                ))
              : []),
          ];
        })}
      </tbody>
    </table>
  );
}
