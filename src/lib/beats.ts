/**
 * How the rumor types are presented, as distinct from how they are stored.
 *
 * Extraction still records `buyout` and `waiver` separately and the enum is
 * untouched. They are merged here, at the surface, because the split is real
 * to the CBA and not to the reader:
 *
 *   - A buyout IS a waiver. The player agrees to give back salary and the club
 *     then waives him; every completed buyout on the site ends on the wire.
 *     The negotiation and the transaction it produces were filed apart.
 *   - Both answer the same question — this contract is ending mid-deal and the
 *     player is about to be available.
 *   - `buyout` held four posts, fewer than the `other` bucket that was hidden
 *     for being a dead end. A filter returning four results is not a way in.
 *   - The split rested on which word the reporting happened to use: of twelve
 *     waiver posts none said "buyout", and of four buyout posts one mentioned
 *     waivers. Two outlets phrasing one event differently filed it twice.
 *
 * Merging here rather than in the data keeps the distinction queryable, needs
 * no migration and no backfill of existing rows, and reverts by deleting a
 * line. Old `?cat=buyout` and `?cat=waiver` links still resolve, because an
 * ungrouped key falls through to itself.
 */

/** Presentation key to the stored types it covers. */
export const BEAT_GROUPS: Record<string, string[]> = {
  releases: ["buyout", "waiver"],
};

/**
 * Types that exist in the data but are not offered as a way in.
 *
 * "Other" is extraction's fallback bucket rather than a subject anyone comes
 * looking for, and a nav item named after our own leftovers invites a click it
 * cannot satisfy. The posts keep their type and still appear under Latest.
 */
export const HIDDEN_BEATS = new Set(["other"]);

/** The stored types a category filter should match. */
export function typesForCat(cat: string): string[] {
  return BEAT_GROUPS[cat] ?? [cat];
}

/** The presentation key a stored type belongs to. */
export function catForType(type: string): string {
  for (const [key, types] of Object.entries(BEAT_GROUPS)) {
    if (types.includes(type)) return key;
  }
  return type;
}

/**
 * Labels, keyed by presentation category rather than by stored type.
 *
 * Two registers on purpose. The rail is a list of beats and takes title case
 * alongside its neighbours; the chips and the card labels are set in caps by
 * CSS and are written in sentence case at source, as the rest of those two
 * components already are.
 */
export const RAIL_LABEL: Record<string, string> = {
  trade: "Trade Rumors",
  signing: "Contract Signings",
  free_agency: "Free Agency",
  extension: "Contract Extensions",
  releases: "Releases",
  draft: "NBA Draft",
  injury_impact: "Injury Room",
  other: "Other",
};

export const CHIP_LABEL: Record<string, string> = {
  trade: "Trades",
  signing: "Signings",
  free_agency: "Free agency",
  extension: "Extensions",
  releases: "Releases",
  draft: "NBA draft",
};

/**
 * The chips above the feed, in the order they are shown.
 *
 * Hand-ordered, and not by volume — the rail sorts itself by count, this does
 * not. It follows a move's life instead: a player is traded, signs, reaches
 * free agency, extends, is released, and the draft brings new ones in.
 */
export const CHIP_ORDER = [
  "trade",
  "signing",
  "free_agency",
  "extension",
  "releases",
  "draft",
];

/**
 * Fold raw per-type counts into the categories the rail shows, dropping the
 * hidden ones and keeping the largest first.
 */
export function groupBeatCounts(
  rows: { type: string; n: number }[],
): { key: string; label: string; n: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (HIDDEN_BEATS.has(row.type)) continue;
    const key = catForType(row.type);
    totals.set(key, (totals.get(key) ?? 0) + row.n);
  }
  return [...totals.entries()]
    .map(([key, n]) => ({ key, label: RAIL_LABEL[key] ?? key, n }))
    .sort((a, b) => b.n - a.n);
}
