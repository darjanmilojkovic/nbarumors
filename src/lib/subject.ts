/**
 * Which player a post is filed under, decided the same way everywhere.
 *
 * Three places used to answer this and none of them agreed: the rumor page
 * sorted the primaries by prominence, the card sorted primary-first then by
 * whether we held a photo, and the feed query simply took the first primary
 * row it found. On a post with one subject they land together, which is why it
 * went unnoticed; on a post with two they can each pick a different player, and
 * the same story then files under one name in the feed and another on its own
 * page.
 *
 * The order, and why each key is where it is:
 *
 *   1. SUBJECTS FIRST. A player the post is about outranks one it merely
 *      names, which is what is_primary is for.
 *
 *   2. PROMINENCE. A marquee name is the one a reader is looking for, and it
 *      stays above mention order so a sentence that happens to open with a
 *      role player cannot demote the star it is really about.
 *
 *   3. FIRST MENTION IN THE HEADLINE. Prominence saturates — 40 players sit at
 *      exactly 100 — so ties are the common case at the top, which is where
 *      this does its work. We WRITE the headline, and the prompt tells it to
 *      lead with the substance, so the order names appear in is our own
 *      editorial judgement about what the story is. It used to be thrown away.
 *
 *      "Embiid to Washington, Davis to Philadelphia" and "Embiid to Houston,
 *      Durant to Philadelphia" are the same construction, and alphabetical
 *      filed the first under Davis and the second under Embiid — two
 *      near-identical Embiid stories under different players, decided by which
 *      co-star happened to be in each.
 *
 *   4. FULL NAME. A deterministic floor, so nothing is left to row order. It
 *      begins with the first name, which is the order the chips at the foot of
 *      a post already read in.
 */

export type Subject = {
  isPrimary: boolean;
  prominence: number;
  fullName: string;
};

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Where a player is first named in the headline, or the end if they are not.
 *
 * Full name first, then the surname alone, because headlines mostly use the
 * surname — "Embiid to Washington" never says Joel. Two players sharing a
 * surname resolve to the same position and fall through to the name key, which
 * is the right outcome: the headline genuinely does not separate them.
 */
export function mentionIndex(headline: string, fullName: string): number {
  const surname = fullName.split(" ").slice(-1)[0];
  for (const part of [fullName, surname]) {
    if (part.length < 3) continue;
    const m = headline.match(
      new RegExp("\\b" + part.replace(RE_SPECIAL, "\\$&") + "\\b", "i"),
    );
    if (m?.index !== undefined) return m.index;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Every tagged player, in the order the post is about them. */
export function sortSubjects<T extends Subject>(players: T[], headline: string): T[] {
  return [...players].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      b.prominence - a.prominence ||
      mentionIndex(headline, a.fullName) - mentionIndex(headline, b.fullName) ||
      a.fullName.localeCompare(b.fullName),
  );
}

/** The one player the post is filed under. */
export function leadSubject<T extends Subject>(
  players: T[],
  headline: string,
): T | undefined {
  return sortSubjects(players, headline)[0];
}
