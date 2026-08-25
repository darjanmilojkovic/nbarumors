import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * One-off backfill: collapse rumors that were published before event keys
 * existed. Groups by primary player, asks the model which of that player's
 * headlines describe the same underlying event, then merges each cluster into
 * its earliest post.
 *
 * `npm run dedupe -- --dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors, rumorSources, rumorPlayers, players, sources } = await import(
    "@/db/schema"
  );
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const rows = await db
    .select({
      id: rumors.id,
      headline: rumors.headline,
      type: rumors.type,
      status: rumors.status,
      confidence: rumors.confidence,
      publishedAt: rumors.publishedAt,
      sourceId: rumors.sourceId,
      feedItemId: rumors.feedItemId,
      sourceUrl: rumors.sourceUrl,
      reportedBy: rumors.reportedBy,
      sourceName: sources.name,
      playerName: players.fullName,
    })
    .from(rumors)
    .innerJoin(sources, eq(sources.id, rumors.sourceId))
    .leftJoin(
      rumorPlayers,
      sql`${rumorPlayers.rumorId} = ${rumors.id} and ${rumorPlayers.isPrimary}`,
    )
    .leftJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(eq(rumors.isPublished, true))
    .orderBy(rumors.publishedAt);

  // Group by primary player + type; only groups with more than one can merge.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.playerName ?? "?"}|${r.type}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const candidates = [...groups.entries()].filter(([, g]) => g.length > 1);
  console.log(
    `${rows.length} published rumors · ${candidates.length} groups to examine\n`,
  );

  const SCHEMA = {
    type: "object",
    properties: {
      clusters: {
        type: "array",
        description:
          "Each cluster is the list of ids describing ONE underlying event. Ids that stand alone get their own single-item cluster.",
        items: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "integer" } },
            event: { type: "string", description: "Short label for the event." },
          },
          required: ["ids", "event"],
          additionalProperties: false,
        },
      },
    },
    required: ["clusters"],
    additionalProperties: false,
  };

  let mergedTotal = 0;

  for (const [key, group] of candidates) {
    const [playerName] = key.split("|");
    const listing = group.map((r) => `${r.id}: ${r.headline}`).join("\n");

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `These are NBA rumor headlines about ${playerName}. Group the ids that describe the SAME underlying transaction or event.\n\n` +
            `Two headlines are the same event only if they report the same move — same teams, same contract, same transaction. ` +
            `Different angles on one player's situation (who is interested, market analysis, a denial, a completed deal) are DIFFERENT events.\n\n` +
            listing,
        },
      ],
    });

    if (res.stop_reason === "refusal") continue;
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    const { clusters } = JSON.parse(text.text) as {
      clusters: { ids: number[]; event: string }[];
    };

    for (const cluster of clusters) {
      const members = cluster.ids
        .map((id) => group.find((g) => g.id === id))
        .filter((m): m is (typeof group)[number] => Boolean(m))
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
      if (members.length < 2) continue;

      const [keeper, ...dupes] = members;
      console.log(`  ${playerName}: ${members.length} → 1  "${keeper.headline}"`);
      for (const d of dupes) console.log(`      + ${d.sourceName}: ${d.headline}`);
      mergedTotal += dupes.length;
      if (dryRun) continue;

      // The keeper and every duplicate become sources on the keeper.
      for (const m of members) {
        await db
          .insert(rumorSources)
          .values({
            rumorId: keeper.id,
            sourceId: m.sourceId,
            feedItemId: m.feedItemId,
            sourceUrl: m.sourceUrl,
            reportedBy: m.reportedBy,
            headline: m.headline,
            publishedAt: m.publishedAt,
          })
          .onConflictDoNothing({ target: rumorSources.feedItemId });
      }

      const rank: Record<string, number> = {
        rumor: 0,
        reported: 1,
        confirmed: 2,
        completed: 3,
        debunked: 4,
      };
      const firmest = members.reduce((a, b) =>
        rank[b.status] > rank[a.status] ? b : a,
      );

      await db
        .update(rumors)
        .set({
          eventKey: cluster.event
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 160),
          status: firmest.status,
          confidence: Math.min(
            1,
            Math.max(...members.map((m) => m.confidence)) + 0.05 * dupes.length,
          ),
        })
        .where(eq(rumors.id, keeper.id));

      // Duplicates come off the feed but stay in the table for auditing.
      for (const d of dupes) {
        await db
          .update(rumors)
          .set({ isPublished: false })
          .where(eq(rumors.id, d.id));
      }
    }
  }

  console.log(
    `\n${dryRun ? "would merge" : "merged"} ${mergedTotal} duplicate posts` +
      `\nremaining published: ${rows.length - (dryRun ? 0 : mergedTotal)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
