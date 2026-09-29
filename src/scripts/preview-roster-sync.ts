import { config } from "dotenv";
config({ path: ".env.local" });
/**
 * Preview what the nightly roster sync would change, without changing it.
 *
 * Fetches nba.com's live index, applies syncOfficialRoster's write and the
 * real BEST_TEAM ranking inside a transaction on a dedicated connection,
 * prints every club that would move, gain or clear, then ROLLS BACK.
 * neon-http cannot hold a transaction open, hence the websocket Pool.
 *
 *   npx tsx src/scripts/preview-roster-sync.ts
 */
type Before = { id: number; full_name: string; club: string | null; is_active: boolean; listed: boolean };
type Change = Before & { now: string | null; nowActive: boolean };

async function main() {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  neonConfig.webSocketConstructor = globalThis.WebSocket as never;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { sql } = await import("drizzle-orm");
  const { BEST_TEAM } = await import("@/lib/current-team");
  const { fetchLeagueIndex } = await import("@/lib/roster-nba");

  const index = await fetchLeagueIndex();
  console.log("league index rows:", index.length);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const dialect = new PgDialect();
  try {
    await c.query("begin");
    const before = await c.query(`select p.id, p.full_name, t.abbreviation club, p.is_active,
        exists (select 1 from rumor_players rp join rumors r on r.id=rp.rumor_id and r.is_published where rp.player_id=p.id) listed
      from players p left join teams t on t.id=p.current_team_id`);
    const was = new Map((before.rows as Before[]).map((r) => [r.id, r]));

    // Mirror of syncOfficialRoster's single statement.
    await c.query(
      `update players p set roster_team_id = t.id, is_active = (t.id is not null), roster_synced_at = now()
         from (select unnest($1::text[]) nba, unnest($2::text[]) team) v
         left join teams t on t.nba_team_id = v.team
        where p.nba_player_id = v.nba`,
      [index.map((e) => e.nbaPlayerId), index.map((e) => e.nbaTeamId)],
    );
    await c.query(
      `update players set roster_team_id = null, is_active = false, roster_synced_at = now()
        where nba_player_id is not null and not (nba_player_id = any($1::text[]))`,
      [index.map((e) => e.nbaPlayerId)],
    );
    const q = dialect.sqlToQuery(sql`${BEST_TEAM} update players set current_team_id = best.team_id from best
      where players.id = best.player_id and players.current_team_id is distinct from best.team_id`);
    const upd = await c.query(q.sql, q.params);
    console.log("current_team_id rows that would change:", upd.rowCount);

    const after = await c.query(`select p.id, t.abbreviation club, p.is_active from players p left join teams t on t.id=p.current_team_id`);
    const changes = after.rows
      .map((r: { id: number; club: string | null; is_active: boolean }) => ({ ...was.get(r.id)!, now: r.club, nowActive: r.is_active }) as Change)
      .filter((r) => r.club !== r.now);
    const kind = (r: Change) => (r.club && !r.now ? "cleared" : !r.club && r.now ? "gained" : "moved");
    for (const k of ["moved", "gained", "cleared"]) {
      const list = changes.filter((r: Change) => kind(r) === k);
      console.log(`\n${k.toUpperCase()}: ${list.length} (on the site: ${list.filter((r: Change) => r.listed).length})`);
      console.log(list.filter((r: Change) => r.listed).map((r: Change) => `${r.full_name} ${r.club ?? "—"}→${r.now ?? "—"}`).join("; "));
    }
    const kept = await c.query(`select p.full_name, t.abbreviation club from players p join teams t on t.id=p.current_team_id
      where not p.is_active and exists (select 1 from rumor_players rp join rumors r on r.id=rp.rumor_id and r.is_published where rp.player_id=p.id)
      order by p.prominence desc`);
    console.log(`\nNOT ON nba.com BUT KEEP A CLUB (recent evidence), on the site, all:\n` + (kept.rows as { full_name: string; club: string }[]).map((r) => `${r.full_name} ${r.club}`).join("; "));
  } finally {
    await c.query("rollback");
    c.release();
    await pool.end();
    console.log("\nrolled back — nothing written");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
