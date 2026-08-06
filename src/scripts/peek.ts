import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

/** Quick look at what ingestion actually landed. `npm run peek` */
async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const [totals] = await sql`
    select count(*)::int as items,
           count(distinct url_hash)::int as unique_urls,
           min(published_at) as oldest,
           max(published_at) as newest
    from feed_items`;
  console.log("feed_items:", totals);

  const hosts = await sql`
    select split_part(split_part(url, '://', 2), '/', 1) as host, count(*)::int
    from feed_items group by 1 order by 2 desc limit 8`;
  console.log("\ntop publishers:");
  for (const h of hosts) console.log(`  ${String(h.count).padStart(4)}  ${h.host}`);

  const pubs = await sql`
    select coalesce(publisher, '(none)') as publisher, count(*)::int
    from feed_items group by 1 order by 2 desc limit 10`;
  console.log("\npublishers identified:");
  for (const p of pubs) {
    console.log(`  ${String(p.count).padStart(4)}  ${p.publisher}`);
  }

  const recent = await sql`
    select f.title, f.publisher, s.slug
    from feed_items f join sources s on s.id = f.source_id
    order by f.published_at desc limit 12`;
  console.log("\nmost recent headlines:");
  for (const r of recent) {
    console.log(
      `  ${String(r.title).slice(0, 78).padEnd(78)} — ${r.publisher ?? "?"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
