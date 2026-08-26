import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

/**
 * How often does fetching actually work, per outlet?
 *
 * Paywalls, consent walls, 403s and video stubs all fail differently and all
 * fail silently into the teaser. Worth knowing the real rate before trusting
 * the feature, and worth re-running if an outlet changes its markup.
 *
 *   npm run test:fetch -- [per-source sample size, default 6]
 */
async function main() {
  const n = Number(process.argv[2] ?? 6);
  const { db } = await import("@/db");
  const { bestText, FETCH_ARTICLE_SOURCES } = await import("@/lib/article");

  for (const slug of FETCH_ARTICLE_SOURCES) {
    const res = await db.execute(sql`
      select f.url, coalesce(f.raw_summary,'') as raw_summary
        from feed_items f join sources s on s.id = f.source_id
       where s.slug = ${slug}
       order by f.published_at desc limit ${n}`);
    const rows = (res.rows ?? res) as Record<string, string>[];

    let ok = 0;
    const gains: number[] = [];
    const reasons: string[] = [];
    for (const r of rows) {
      const got = await bestText({ url: r.url, rawSummary: r.raw_summary, sourceSlug: slug });
      if (got.fetched) {
        ok++;
        gains.push((got.text ?? "").length);
      } else {
        reasons.push(got.reason ?? "unknown");
      }
    }
    const avg = gains.length ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length) : 0;
    console.log(
      `${slug.padEnd(14)} ${ok}/${rows.length} fetched · avg ${avg} chars` +
        (reasons.length ? ` · skipped: ${reasons.join(", ")}` : ""),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
