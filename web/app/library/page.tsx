import { getMarketDefinitions } from "@db/store";
import {
  codeClass,
  pageTitleClass,
  tableCellClass,
  tableClass,
  tableHeaderCellClass,
} from "@/styles";

export const dynamic = "force-dynamic";

export default function MarketLibraryPage() {
  const definitions = getMarketDefinitions();

  return (
    <div>
      <h1 className={pageTitleClass}>Market library</h1>
      <p className="mb-4 max-w-3xl text-muted">
        Every market the analyzer understands. Each source's raw market ids are
        normalized to one internal code, so the analysis works the same no
        matter where the odds come from. (Current sources: oddspapi.io)
      </p>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={tableHeaderCellClass}>Internal code</th>
            <th className={tableHeaderCellClass}>Name</th>
            <th className={tableHeaderCellClass}>IDs</th>
            <th className={tableHeaderCellClass}>Matches</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((definition) => (
            <tr key={definition.code}>
              <td className={tableCellClass}>
                <code className={codeClass}>{definition.code}</code>
              </td>
              <td className={tableCellClass}>{definition.displayName}</td>
              <td className={`${tableCellClass} align-top text-muted`}>
                <details className="w-64">
                  <summary className="cursor-pointer select-none text-gold">
                    {definition.externalIds.length}{" "}
                    {definition.externalIds.length === 1 ? "ID" : "IDs"}
                  </summary>
                  <div className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-y-auto pr-1">
                    {definition.externalIds.map((externalId) => (
                      <span
                        key={externalId}
                        className="rounded bg-navy-deep px-1.5 py-0.5 text-xs text-muted"
                      >
                        {externalId}
                      </span>
                    ))}
                  </div>
                </details>
              </td>
              <td className={tableCellClass}>{definition.matchCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
