import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, sql } from "drizzle-orm";

/**
 * Backfill the "from" team — the club a player is leaving — on posts that
 * recorded only a destination.
 *
 * The extractor used to read "from = losing the player" as trade-specific, so
 * signings, buyouts and waivers logged a "to" and nothing else. That is why
 * most posts show no "DAL → MIA" movement chip. The prompt is fixed for new
 * items; this repairs the ones already published.
 *
 * Deliberately NOT a re-extraction. Re-running the full pipeline would rewrite
 * headlines and bodies that have already been reviewed, as a side effect of
 * fixing a team tag. This asks one narrow question, reads the ORIGINAL feed
 * text rather than our summary of it, and writes nothing but a role.
 *
 *   npm run backfill:from -- --dry --limit 10   preview + measured cost
 *   npm run backfill:from -- --limit 10         apply to ten
 *   npm run backfill:from                       apply to all
 */

/*
 * Rates are per million tokens and are only used for the cost read-out — they
 * are not billing truth. Check them against current pricing before trusting a
 * projection, or pass your own via env.
 */
const IN_RATE = Number(process.env.PRICE_IN_PER_MTOK ?? 5);
const OUT_RATE = Number(process.env.PRICE_OUT_PER_MTOK ?? 25);

async function main() {
  const dryRun = process.argv.includes("--dry");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : null;

  const { db } = await import("@/db");
  const { rumors, rumorTeams, teams, feedItems, rumorPlayers, players } =
    await import("@/db/schema");
  const { SEED_TEAMS } = await import("@/db/seed-data/teams");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const TEAM_LIST = SEED_TEAMS.map(
    (t) => `${t.abbreviation}=${t.city} ${t.name}`,
  ).join(", ");

  const teamRows = await db
    .select({ id: teams.id, abbreviation: teams.abbreviation })
    .from(teams);
  const teamByAbbrev = new Map(teamRows.map((t) => [t.abbreviation, t.id]));

  /*
   * Only posts that named a destination and no origin. Anything already
   * carrying a "from" is left alone — this must not overwrite extractions
   * that got it right.
   */
  const candidates = await db
    .select({
      id: rumors.id,
      slug: rumors.slug,
      headline: rumors.headline,
      body: rumors.body,
      type: rumors.type,
      title: feedItems.title,
      rawSummary: feedItems.rawSummary,
      /*
       * Who the post is actually about. Without naming them, the model pulled
       * any team standing near any player: it read "defended his Warriors
       * legacy" as Klay's origin when he came from Dallas, and lifted a
       * Thompson buyout out of a roundup to answer a question about three
       * other players entirely.
       */
      primaryPlayer: players.fullName,
    })
    .from(rumors)
    .leftJoin(feedItems, eq(feedItems.id, rumors.feedItemId))
    .leftJoin(
      rumorPlayers,
      sql`${rumorPlayers.rumorId} = ${rumors.id} and ${rumorPlayers.isPrimary}`,
    )
    .leftJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(
      and(
        eq(rumors.isPublished, true),
        sql`exists (select 1 from rumor_teams rt where rt.rumor_id = ${rumors.id} and rt.role = 'to')`,
        sql`not exists (select 1 from rumor_teams rt where rt.rumor_id = ${rumors.id} and rt.role = 'from')`,
      ),
    )
    .orderBy(sql`${rumors.publishedAt} desc`)
    .limit(limit ?? 10_000);

  console.log(
    `${candidates.length} posts with a destination but no origin${limit ? ` (limited to ${limit})` : ""}\n`,
  );

  const SCHEMA = {
    type: "object",
    properties: {
      fromAbbreviation: {
        type: ["string", "null"],
        description: `The team THE NAMED PLAYER is leaving as part of THIS move — traded away by, waived by, bought out by, or cleared waivers from. Return null unless all of these hold: (1) the item names a single player moving, (2) the text says where that specific player is coming from, and (3) it is the club they are leaving in this transaction, not a former club from earlier in their career. A team mentioned only because the player once played there, or because they averaged points there, is NOT the origin. If the item covers several players, or is a roundup, or names teams merely as suitors, return null. Prefer null over a guess. Valid: ${TEAM_LIST}`,
      },
      evidence: {
        type: ["string", "null"],
        description:
          "The few words from the text that establish the origin team, or null if fromAbbreviation is null.",
      },
    },
    required: ["fromAbbreviation", "evidence"],
    additionalProperties: false,
  } as const;

  let inTokens = 0;
  let outTokens = 0;
  let found = 0;
  let written = 0;
  let skippedSameTeam = 0;

  for (const c of candidates) {
    // Prefer the original wire text; fall back to our own summary of it.
    const source = c.title
      ? `Headline: ${c.title}\nSummary: ${c.rawSummary ?? "(none)"}`
      : `Headline: ${c.headline}\nSummary: ${c.body}`;

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            `This ${c.type} item is about ${c.primaryPlayer ?? "one player"}.`,
            `Which NBA team is ${c.primaryPlayer ?? "that player"} leaving as part of this move? Answer null if the text does not say.`,
            "",
            source,
          ].join("\n"),
        },
      ],
    });

    inTokens += res.usage.input_tokens;
    outTokens += res.usage.output_tokens;

    if (res.stop_reason === "refusal") continue;
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    const { fromAbbreviation, evidence } = JSON.parse(text.text) as {
      fromAbbreviation: string | null;
      evidence: string | null;
    };
    if (!fromAbbreviation) continue;

    const teamId = teamByAbbrev.get(fromAbbreviation.toUpperCase());
    if (!teamId) {
      console.log(`  ? ${c.slug}: unknown abbreviation "${fromAbbreviation}"`);
      continue;
    }

    /*
     * A team cannot be both ends of the same move. If the model returns the
     * destination, that is a misread and the row would corrupt the chip.
     */
    const [clash] = await db
      .select({ role: rumorTeams.role })
      .from(rumorTeams)
      .where(and(eq(rumorTeams.rumorId, c.id), eq(rumorTeams.teamId, teamId)));
    if (clash?.role === "to") {
      skippedSameTeam++;
      continue;
    }

    found++;
    console.log(
      `  ${fromAbbreviation} → ${c.slug.slice(0, 52)}${evidence ? `\n      "${evidence}"` : ""}`,
    );
    if (dryRun) continue;

    /*
     * The team may already be attached as "mentioned"; the primary key is
     * (rumor_id, team_id), so that is a role promotion, not an insert.
     */
    if (clash) {
      await db
        .update(rumorTeams)
        .set({ role: "from" })
        .where(
          and(eq(rumorTeams.rumorId, c.id), eq(rumorTeams.teamId, teamId)),
        );
    } else {
      await db
        .insert(rumorTeams)
        .values({ rumorId: c.id, teamId, role: "from" })
        .onConflictDoNothing();
    }
    written++;
  }

  const cost = (inTokens / 1e6) * IN_RATE + (outTokens / 1e6) * OUT_RATE;
  const per = candidates.length ? cost / candidates.length : 0;

  console.log(
    `\n${dryRun ? "would set" : "set"} an origin team on ${dryRun ? found : written} of ${candidates.length}` +
      (skippedSameTeam
        ? `\nskipped ${skippedSameTeam} where the model returned the destination`
        : "") +
      `\n\ntokens: ${inTokens.toLocaleString()} in · ${outTokens.toLocaleString()} out` +
      `\ncost at ${IN_RATE}/${OUT_RATE} per Mtok: $${cost.toFixed(4)} — $${per.toFixed(5)}/post`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
