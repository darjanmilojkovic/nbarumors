import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Pull every NBA roster and mark those players active.
 * `npm run sync:roster` — run before `sync:stats`, which layers prominence
 * and headshots on top.
 */
async function main() {
  const { db } = await import("@/db");
  const { players, teams } = await import("@/db/schema");
  const { fetchLeagueRosters } = await import("@/lib/roster");
  const { nameKey } = await import("@/lib/stats");

  console.log("fetching 30 team rosters...");
  let failed = 0;
  const roster = await fetchLeagueRosters(2026, (abbrev, n) => {
    if (n < 0) {
      failed++;
      process.stdout.write(`  ${abbrev}:ERR`);
    } else {
      process.stdout.write(`  ${abbrev}:${n}`);
    }
  });
  console.log(`\n\nrostered players: ${roster.length}${failed ? ` (${failed} teams failed)` : ""}`);

  if (roster.length < 300) {
    console.log("refusing to sync — that is too few to be a full league.");
    return;
  }

  const teamRows = await db
    .select({ id: teams.id, abbreviation: teams.abbreviation })
    .from(teams);
  const teamId = new Map(teamRows.map((t) => [t.abbreviation, t.id]));

  const slugify = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  // Everything starts inactive; the roster below re-activates.
  await db.update(players).set({ isActive: false });

  let inserted = 0;
  let updated = 0;
  for (const p of roster) {
    const rows = await db
      .insert(players)
      .values({
        slug: slugify(p.name),
        fullName: p.name,
        aliases: [nameKey(p.name)],
        currentTeamId: teamId.get(p.teamAbbrev) ?? null,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: players.slug,
        set: {
          isActive: true,
          currentTeamId: teamId.get(p.teamAbbrev) ?? null,
          fullName: sql`excluded.full_name`,
        },
      })
      .returning({ id: players.id });
    if (rows.length > 0) updated++;
    else inserted++;
  }

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${players.isActive})::int`,
      withTeam: sql<number>`count(*) filter (where ${players.currentTeamId} is not null)::int`,
    })
    .from(players);

  console.log(`  upserted: ${updated}, skipped: ${inserted}`);
  console.log(
    `  players total ${counts.total} · active ${counts.active} · with team ${counts.withTeam}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
