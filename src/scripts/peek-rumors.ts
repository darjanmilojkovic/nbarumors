import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

/** Show published rumors with their tags. `npm run peek:rumors` */
async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const rows = await sql`
    select r.id, r.headline, r.body, r.type, r.status, r.confidence,
           r.reported_by, r.source_url, r.is_published,
           (select string_agg(t.abbreviation || ':' || rt.role, ' ')
              from rumor_teams rt join teams t on t.id = rt.team_id
             where rt.rumor_id = r.id) as teams,
           (select string_agg(p.full_name, ', ')
              from rumor_players rp join players p on p.id = rp.player_id
             where rp.rumor_id = r.id) as players,
           (select pi.url from player_images pi where pi.id = r.image_id) as image
    from rumors r order by r.published_at desc`;

  for (const r of rows) {
    console.log(`\n─── ${r.headline}`);
    console.log(`    ${r.body}`);
    console.log(
      `    ${r.type}/${r.status} conf=${Number(r.confidence).toFixed(2)}` +
        `${r.is_published ? "" : " [HELD]"} | teams: ${r.teams ?? "-"}`,
    );
    console.log(`    players: ${r.players ?? "-"}`);
    console.log(`    by: ${r.reported_by ?? "-"} | ${r.source_url.slice(0, 70)}`);
    console.log(`    image: ${r.image ? r.image.slice(0, 70) : "none"}`);
  }

  const [counts] = await sql`
    select (select count(*)::int from rumors) rumors,
           (select count(*)::int from players) players,
           (select count(*)::int from player_images) images,
           (select count(*)::int from feed_items where processed_at is not null) processed`;
  console.log(`\n${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
