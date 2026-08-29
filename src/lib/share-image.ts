/**
 * Whether a Commons file is actually a photograph of the player it is filed
 * under, and therefore fit to be the share card.
 *
 * `findCommonsImages` runs a full-text search on the player's name and takes
 * the best landscape result, which for a common surname matches whatever else
 * on Commons carries that word. 41 of 428 stored images are not photographs of
 * anyone: Coby White has a 1924 price list for White Elm Nursery Co., Collin
 * Murray-Boyles a New York county map, Chris Livingston a mill in Scotland, and
 * a post mentioning Gabe Vincent shared as a scanned page from a 1663 English
 * almanac whose author was named Vincent.
 *
 * That went unnoticed for a simple reason: these images were never displayed.
 * They sat in the database powering nothing until og:image was wired up, which
 * handed an unreviewed library the most public job on the site.
 *
 * This is the guard at the point of use. It does not clean the data — a
 * separate pass can drop the bad rows so they re-resolve — but nothing wrong
 * reaches a share card in the meantime.
 */

/** Digitised documents, renders and diagrams. Never a photo of a person. */
const NOT_A_PHOTO =
  /\.pdf\.|\.svg\.png$|_sig\.|signature|_logo|wordmark|crest|\bmap\b|diagram|chart|almanack|catalog|bulletin|price[_ ]list/i;

/**
 * A file whose name does not carry the player's given name is almost always a
 * surname collision. This one test removes most of them, and it is deliberately
 * the given name rather than the surname: the surname is what collides.
 */
function namesThePlayer(file: string, fullName: string): boolean {
  /*
   * Punctuation is stripped from both sides before comparing, because Commons
   * filenames drop it and our names keep it. "De'Aaron Fox" is filed as
   * DeAaron_Fox_DBZ_2.jpg, and an exact match rejected a real photo of him.
   */
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const haystack = norm(file);
  const first = fullName.trim().split(/\s+/)[0] ?? "";

  /* Initials like "AJ" or "CJ" carry no signal; do not test on them. */
  if (norm(first).length < 3) return true;

  if (haystack.includes(norm(first))) return true;

  /*
   * A hyphenated given name is often filed under its first half:
   * "Karl-Anthony Towns" appears as Karl_Towns_dunk.JPG. Segments shorter than
   * three characters are skipped, since they match almost anything.
   */
  return first
    .split("-")
    .some((part) => norm(part).length >= 3 && haystack.includes(norm(part)));
}

/**
 * A card is landscape-ish. A 1200x2313 portrait crops to a sliver, and the two
 * in the library at that shape are unusable at any size.
 */
const TOO_TALL = 1.6;

export function isUsableShareImage(
  url: string | null | undefined,
  fullName: string,
  width?: number | null,
  height?: number | null,
): boolean {
  if (!url) return false;

  const file = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  if (!file) return false;
  if (NOT_A_PHOTO.test(file)) return false;
  if (!namesThePlayer(file, fullName)) return false;
  if (width && height && height / width > TOO_TALL) return false;

  return true;
}

/** Wide enough for a large card rather than a thumbnail. */
export function isWideEnough(width?: number | null): boolean {
  return (width ?? 0) >= 600;
}
