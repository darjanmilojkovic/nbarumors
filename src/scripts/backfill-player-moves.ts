import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, sql } from "drizzle-orm";

/**
 * Fill in each player's own from/to team on posts that move more than one.
 *
 * rumor_teams says a post involves GSW, ATL and MIL. It cannot say that Butler
 * goes to Atlanta and Kuminga to Milwaukee, so the card could only draw one
 * arrow and picked its destination from whatever order the rows came back in.
 * The columns exist now; these are the posts published before they did.
 *
 * Only the two new columns are written. Bodies, headlines, teams, players and
 * dates are untouched, so there is nothing to back up: the columns were null
 * before this ran and null is where they return.
 *
 *   npm run backfill:moves -- --dry
 *   npm run backfill:moves
 */
async function main() {
  const dryRun = process.argv.includes("--dry");

  const { db } = await import("@/db");
  const { rumorPlayers, teams } = await import("@/db/schema");
  const { extractRumor } = await import("@/lib/extract");

  /*
   * Every post where more than one player moves.
   *
   * The first pass asked for more than one DESTINATION team, which caught the
   * three-team proposals and missed every ordinary two-team trade: Lillard to
   * Boston for Hauser and Scheierman has one destination on the post, but
   * three players going in two directions, and one arrow cannot say that.
   *
   * Requiring two involved teams keeps out the roundups that merely name
   * several players without moving any of them.
   */
  const res = await db.execute(sql`
    select r.id, r.slug, r.headline, r.body, f.title,
           coalesce(f.raw_summary,'') as raw_summary,
           coalesce(nullif(f.publisher,''), s.name) as outlet
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.is_published
       and (select count(*) from rumor_players rp where rp.rumor_id = r.id) > 1
       and (select count(*) from rumor_teams rt
             where rt.rumor_id = r.id and rt.role <> 'mentioned') > 1
       and (select count(*) from rumor_players rp
             where rp.rumor_id = r.id and rp.to_team_id is not null) = 0
     order by r.published_at desc`);
  const rows = (res.rows ?? res) as Record<string, string>[];
  console.log(`${rows.length} posts where more than one player moves\n`);

  const teamRows = await db.select({ id: teams.id, abbreviation: teams.abbreviation }).from(teams);
  const byAbbrev = new Map(teamRows.map((t) => [t.abbreviation, t.id]));

  const playerRows = await db
    .select({ id: sql<number>`p.id`, name: sql<string>`p.full_name` })
    .from(sql`players p`);
  const byName = new Map(playerRows.map((p) => [p.name.toLowerCase(), p.id]));

  let filled = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    /*
     * Our own summary goes in alongside the feed text. For the Google News
     * posts the feed text is the headline repeated, but the body was rewritten
     * from the article and already names who goes where — no point fetching
     * the page again to learn what we have written down.
     */
    const out = await extractRumor({
      title: r.title,
      rawSummary: [r.raw_summary, r.body].filter(Boolean).join("\n\n"),
      publisher: r.outlet,
      sourceName: r.outlet,
    });

    const moves = out.players.filter((p) => p.fromTeam && p.toTeam);
    if (moves.length < 2) {
      skipped.push(`${r.slug}: model found ${moves.length} directed player(s)`);
      continue;
    }

    let wrote = 0;
    for (const p of moves) {
      const playerId = byName.get(p.name.toLowerCase());
      const fromId = p.fromTeam ? byAbbrev.get(p.fromTeam) : undefined;
      const toId = p.toTeam ? byAbbrev.get(p.toTeam) : undefined;
      if (playerId == null || fromId == null || toId == null) continue;

      console.log(`  ${r.slug.slice(0, 50)}  ${p.name}: ${p.fromTeam} → ${p.toTeam}`);
      wrote++;
      if (!dryRun) {
        await db
          .update(rumorPlayers)
          .set({ fromTeamId: fromId, toTeamId: toId })
          .where(
            and(eq(rumorPlayers.rumorId, Number(r.id)), eq(rumorPlayers.playerId, playerId)),
          );
      }
    }
    if (wrote >= 2) filled++;
    else skipped.push(`${r.slug}: only ${wrote} row(s) resolved to known players and teams`);
  }

  console.log(`\n${dryRun ? "would fill" : "filled"} ${filled} of ${rows.length} posts`);
  if (skipped.length) {
    console.log(`\nleft alone (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
