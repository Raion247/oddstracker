/**
 * market-map.js - canonical market taxonomy + per-provider translation.
 *
 * The analysis code speaks ONLY in the canonical constants (left side).
 * Each provider block tells the resolver how to recognize that market in that
 * provider's data. To plug in a different odds API, add a provider block per
 * canonical market - no analysis code changes needed.
 *
 * Matcher kinds (any combination; first hit wins):
 *   marketIds:    [numbers]  - provider's numeric market ids
 *   names:        [strings]  - exact market name match (case-insensitive)
 *   namePatterns: [regex]    - market name regex match
 *
 * Example of adding your own API:
 *   CORRECT_SCORE_FT: {
 *     oddspapi:  { marketIds: [10336, 102053] },
 *     mycustomapi: { names: ["Correct Score", "CS"] },
 *   },
 */

module.exports = {
  // 1X2 family
  FULL_TIME_RESULT:   { oddspapi: { marketIds: [101] } },
  FIRST_HALF_RESULT:  { oddspapi: { marketIds: [10208] } },
  SECOND_HALF_RESULT: { oddspapi: { marketIds: [10211] } },
  DOUBLE_CHANCE:      { oddspapi: { marketIds: [101902, 101905, 101908] } },
  DRAW_NO_BET:        { oddspapi: { marketIds: [10214, 10320, 10322] } },
  HALFTIME_FULLTIME:  { oddspapi: { marketIds: [101919] } },

  // score markets
  CORRECT_SCORE_FT:   { oddspapi: { marketIds: [10336, 102053] } }, // Correct Score / Exact Score
  CORRECT_SCORE_1H:   { oddspapi: { marketIds: [102462, 102116] } },
  CORRECT_SCORE_2H:   { oddspapi: { marketIds: [102526] } },

  // totals (many line-variant ids -> match by name)
  OVER_UNDER_FT:      { oddspapi: { names: ["Over Under Full Time"] } },
  OVER_UNDER_1H:      { oddspapi: { names: ["Over Under First Half"] } },
  OVER_UNDER_2H:      { oddspapi: { names: ["Over Under Second Half"] } },
  OVER_UNDER_TEAM1:   { oddspapi: { namePatterns: [/^Over Under Team 1/] } },
  OVER_UNDER_TEAM2:   { oddspapi: { namePatterns: [/^Over Under Team 2/] } },

  // handicaps
  EUROPEAN_HANDICAP:    { oddspapi: { names: ["European Handicap"] } },
  EUROPEAN_HANDICAP_1H: { oddspapi: { names: ["European Handicap First Half"] } },
  ASIAN_HANDICAP:       { oddspapi: { names: ["Asian Handicap"] } },
  ASIAN_HANDICAP_1H:    { oddspapi: { names: ["Asian Handicap First Half"] } },
  ASIAN_HANDICAP_2H:    { oddspapi: { names: ["Asian Handicap Second Half"] } },

  // both teams to score
  BTTS:               { oddspapi: { marketIds: [104] } },
  BTTS_1H:            { oddspapi: { marketIds: [10300] } },
  BTTS_2H:            { oddspapi: { marketIds: [10302] } },

  // goals misc
  ODD_EVEN_FT:        { oddspapi: { marketIds: [10222] } },
  FIRST_GOAL:         { oddspapi: { marketIds: [10216] } },
  LAST_GOAL:          { oddspapi: { marketIds: [10219] } },
  WINNING_MARGIN:     { oddspapi: { marketIds: [101936] } },
  HIGHEST_SCORING_HALF: { oddspapi: { marketIds: [102041] } },
  TO_WIN_FROM_BEHIND: { oddspapi: { marketIds: [102050] } },

  // corners / bookings families
  CORNERS_1X2:        { oddspapi: { marketIds: [10764, 101532] } },
  CORNERS_OVER_UNDER: { oddspapi: { namePatterns: [/^Corners - Over Under/] } },
  BOOKINGS_1X2:       { oddspapi: { marketIds: [10911] } },
  BOOKINGS_OVER_UNDER:{ oddspapi: { namePatterns: [/^Bookings - Over Under/] } },
};

/**
 * Resolve a provider's market to a canonical constant.
 * @param provider  e.g. "oddspapi"
 * @param market    { marketId?, marketName? } - whatever the provider gives
 * @returns canonical key string, or null if unmapped
 */
module.exports.resolve = function resolve(provider, market) {
  const id = market?.marketId != null ? Number(market.marketId) : null;
  const name = (market?.marketName ?? "").toLowerCase();
  for (const [canonical, providers] of Object.entries(module.exports)) {
    if (typeof providers === "function") continue;
    const m = providers[provider];
    if (!m) continue;
    if (m.marketIds && id != null && m.marketIds.includes(id)) return canonical;
    if (m.names && name && m.names.some((n) => n.toLowerCase() === name)) return canonical;
    if (m.namePatterns && market?.marketName && m.namePatterns.some((re) => re.test(market.marketName))) return canonical;
  }
  return null;
};