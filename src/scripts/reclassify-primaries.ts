import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Re-decide which tagged players a published post is ABOUT.
 *
 * `is_primary` was described to the extraction model as "the player the move
 * is actually about" — singular — and it obliged. Of 88 posts naming two or
 * more tagged players in the headline, 73% came back with exactly one primary.
 * The site files a post under the highest-rated primary, so on "P.J.
 * Washington and Prince to Golden State in three-team Kyrie idea" the masthead
 * read Brandin Podziemski, the only flagged player and the least prominent
 * name on the post.
 *
 * The schema description is fixed, but that only changes new posts. This
 * re-decides the existing ones.
 *
 * Deliberately NOT a re-extraction. Running the full prompt again would cost
 * about $10 and rewrite every headline and body — copy that has been tuned
 * over many passes and is not what is wrong. This sends the post we already
 * published plus the names already tagged, and asks one question. It writes to
 * rumor_players.is_primary and nothing else.
 *
 *   npx tsx src/scripts/reclassify-primaries.ts --dry --limit 40
 *   npx tsx src/scripts/reclassify-primaries.ts --apply
 */

const MODEL = process.env.RECLASSIFY_MODEL ?? "claude-haiku-4-5";

const SYSTEM = `You are given an NBA transfer story and the players tagged on it. Decide which of those players the story is ABOUT.

A player is about-the-story if the story reports them moving, or being proposed to move, or signing, or being waived — anything that changes where they play. Every side of a trade qualifies: a deal sending one player out and another back is about both.

A player is NOT about-the-story if they are named only as context: a teammate mentioned in passing, a player another club is also considering, someone whose contract is described for cap reasons, or a coach or executive.

Return the exact names from the list, comma-separated, and nothing else. If none of the listed players is moving, return NONE.`;

type Row = {
  rumorId: number;
  headline: string;
  body: string;
  names: string[];
  current: string[];
};

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

  const { db } = await import("@/db");
  const { players, rumorPlayers, rumors } = await import("@/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const tagged = await db
    .select({
      rumorId: rumors.id,
      headline: rumors.headline,
      body: rumors.body,
      name: players.fullName,
      isPrimary: rumorPlayers.isPrimary,
    })
    .from(rumorPlayers)
    .innerJoin(rumors, eq(rumors.id, rumorPlayers.rumorId))
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(eq(rumors.isPublished, true));

  const byPost = new Map<number, Row>();
  for (const t of tagged) {
    let r = byPost.get(t.rumorId);
    if (!r) {
      r = { rumorId: t.rumorId, headline: t.headline, body: t.body, names: [], current: [] };
      byPost.set(t.rumorId, r);
    }
    r.names.push(t.name);
    if (t.isPrimary) r.current.push(t.name);
  }

  /*
   * Only posts with more than one tagged player can be wrong in the way this
   * fixes. A single-player post has nothing to choose between.
   */
  let posts = [...byPost.values()].filter((p) => p.names.length > 1);
  if (limit) posts = posts.slice(0, limit);
  console.log(`posts with 2+ tagged players: ${posts.length}\n`);

  let changed = 0;
  let spent = 0;
  const examples: string[] = [];

  for (const p of posts) {
    const content = [
      `Headline: ${p.headline}`,
      `Story: ${p.body}`,
      ``,
      `Tagged players: ${p.names.join(", ")}`,
    ].join("\n");

    let said: string;
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: "user", content }],
      });
      const block = res.content.find((b) => b.type === "text");
      said = block && block.type === "text" ? block.text.trim() : "";
      const u = res.usage;
      spent += (u.input_tokens * 1) / 1e6 + (u.output_tokens * 5) / 1e6;
    } catch {
      continue;
    }

    const picked = said
      .split(",")
      .map((s) => s.trim())
      .filter((s) => p.names.includes(s));

    /*
     * Never leave a post with nothing. Three posts already have no primary at
     * all, and the masthead falls back to the post's teams there — a worse
     * answer than the one we have.
     */
    if (picked.length === 0) continue;

    const before = [...p.current].sort().join(", ");
    const after = [...picked].sort().join(", ");
    if (before === after) continue;

    changed++;
    if (examples.length < 25) {
      examples.push(`  ${p.headline.slice(0, 58)}\n     was: ${before || "(none)"}\n     now: ${after}`);
    }

    if (apply) {
      await db
        .update(rumorPlayers)
        .set({ isPrimary: false })
        .where(eq(rumorPlayers.rumorId, p.rumorId));
      await db.execute(sql`
        update rumor_players rp set is_primary = true
        from players p
        where p.id = rp.player_id
          and rp.rumor_id = ${p.rumorId}
          and p.full_name in (${sql.join(picked.map((n) => sql`${n}`), sql`, `)})
      `);
    }
    void and;
  }

  console.log(`posts whose primaries change: ${changed}`);
  for (const e of examples) console.log(e);
  console.log(`\nmodel ${MODEL} · cost $${spent.toFixed(3)}`);
  if (!apply) console.log(`dry run — pass --apply to write`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
