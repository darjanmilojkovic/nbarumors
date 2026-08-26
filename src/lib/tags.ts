import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, rumorPlayers, rumors } from "@/db/schema";

/**
 * Drop player tags naming someone the post does not talk about.
 *
 * Tags are written from the extraction that created a post, so they match its
 * text at that moment. The text then moves: a later report grows the summary,
 * a backfill rewrites it from the article, a repair pass corrects a figure.
 * The tags do not move with it.
 *
 * Klay Thompson's buyout post ended up tagged with Luka Doncic, Kyrie Irving
 * and Anthony Davis — named in an early version that described the Dallas
 * roster he was leaving, absent from every word of the post today. They were
 * on the card as portraits and the post was listed on all three player pages,
 * which is not a display quirk: it says the post is about them.
 *
 * Only non-primary tags are pruned. A subject stays the subject even if a
 * rewrite stops spelling their name out, and losing it would leave a post
 * about nobody.
 */

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Surname alone counts as a mention.
 *
 * A summary that introduces "Karl-Anthony Towns" and then says "Towns" twice
 * is still about him, and the cost of being wrong here is asymmetric: a false
 * match keeps a tag that might be stale, a false miss deletes a real one.
 */
function mentions(text: string, fullName: string): boolean {
  const haystack = norm(text);
  const name = norm(fullName);
  if (haystack.includes(name)) return true;
  const surname = name.split(" ").filter(Boolean).slice(-1)[0] ?? "";
  return surname.length >= 3 && haystack.includes(surname);
}

/**
 * Returns the names dropped, so a caller can log what changed.
 *
 * With { dryRun } it reports without deleting, using this same comparison —
 * a preview written as a separate SQL test disagreed with the real thing on
 * every accented name, because it never stripped diacritics and so proposed
 * dropping Doncic from a post whose headline says Doncic.
 */
export async function pruneStaleTags(
  rumorId: number,
  opts: { dryRun?: boolean } = {},
): Promise<string[]> {
  const [post] = await db
    .select({ headline: rumors.headline, body: rumors.body })
    .from(rumors)
    .where(eq(rumors.id, rumorId))
    .limit(1);
  if (!post) return [];

  const tagged = await db
    .select({ playerId: rumorPlayers.playerId, fullName: players.fullName })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(and(eq(rumorPlayers.rumorId, rumorId), eq(rumorPlayers.isPrimary, false)));

  const text = `${post.headline} ${post.body}`;
  const stale = tagged.filter((t) => !mentions(text, t.fullName));
  if (!stale.length || opts.dryRun) return stale.map((s) => s.fullName);

  await db
    .delete(rumorPlayers)
    .where(
      and(
        eq(rumorPlayers.rumorId, rumorId),
        inArray(
          rumorPlayers.playerId,
          stale.map((s) => s.playerId),
        ),
        eq(rumorPlayers.isPrimary, false),
      ),
    );
  return stale.map((s) => s.fullName);
}
