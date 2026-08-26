/**
 * Matching for the model-generated event keys that decide which reports are
 * the same story.
 *
 * Merging used to be exact string equality, which meant one event survived as
 * several posts whenever two outlets produced different spellings of it. Klay
 * Thompson's move to Miami existed five times over:
 *
 *   klay-thompson-mia-signing-2yr-after-dal-buyout
 *   klay-thompson-mia-signing-after-dal-buyout
 *   klay-thompson-mia-signing-2yr-11.5m
 *   klay-thompson-mia-signing-2yr-11-5m      <- a single punctuation mark
 *   klay-thompson-mia-signing
 *
 * The last pair differed by "." versus "-". Normalising punctuation alone
 * catches that one; the rest need a similarity measure.
 */

/**
 * Words that carry no identity. "deal" and "trade" appear in most keys, so
 * counting them inflates every comparison towards a match.
 */
const NOISE = new Set([
  "the", "a", "an", "to", "for", "on", "in", "of", "and", "with", "from",
  "deal", "nba", "report", "reports", "rumor", "news", "update",
]);

/**
 * Punctuation and separators collapse, so "11.5m", "11-5m" and "11_5m" all
 * become the same token.
 */
export function normalizeEventKey(key: string): string {
  return (key ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function eventKeyTokens(key: string): Set<string> {
  return new Set(
    normalizeEventKey(key)
      .split("-")
      .filter((t) => t.length > 1 && !NOISE.has(t)),
  );
}

/** Jaccard overlap of the meaningful tokens, 0 to 1. */
export function eventKeySimilarity(a: string, b: string): number {
  const A = eventKeyTokens(a);
  const B = eventKeyTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  const shared = [...A].filter((t) => B.has(t)).length;
  return shared / new Set([...A, ...B]).size;
}

/**
 * How alike two keys must be to count as one event.
 *
 * Text similarity is the weakest of the three tests, so it does not have to
 * carry the decision alone: callers also require the same players, the same
 * teams and the same repeat markers. Given those, 0.5 was measured rather than
 * guessed — 0.45 admits nothing further, so the boundary sits in a gap rather
 * than in the middle of a distribution, while 0.6 leaves genuine duplicates
 * standing ("...-market-roundup" against "...-remaining-free-agents-roundup"
 * scores 0.56 and is plainly one story).
 */
export const SAME_EVENT_THRESHOLD = 0.5;

/**
 * Words marking a repeat of an earlier transaction rather than a variant
 * spelling of it.
 *
 * "bez-mbeng-uta-10-day-contract" and "bez-mbeng-uta-second-10-day-contract"
 * differ by exactly one token and score 0.86, but a second 10-day contract is
 * a second signing — same player, same team, genuinely two events. When one
 * key carries such a marker and the other does not, that difference outranks
 * everything they share.
 */
const REPEAT = new Set([
  "second", "third", "fourth", "another", "again", "2nd", "3rd", "4th",
  "re", "renewed", "repeat", "additional", "extra",
]);

const repeatMarkers = (key: string) =>
  [...eventKeyTokens(key)].filter((t) => REPEAT.has(t)).sort().join("-");

export const isSameEvent = (a: string, b: string) => {
  if (repeatMarkers(a) !== repeatMarkers(b)) return false;
  return (
    normalizeEventKey(a) === normalizeEventKey(b) ||
    eventKeySimilarity(a, b) >= SAME_EVENT_THRESHOLD
  );
};
