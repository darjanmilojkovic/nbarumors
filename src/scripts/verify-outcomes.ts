import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Check rumors against the official transaction log.
 *
 * We hold both the rumor stream and Basketball-Reference's record of what
 * actually happened, so a rumor can be marked `confirmed` when a matching
 * transaction landed afterwards.
 *
 * The negative case is deliberately weaker. Our log covers one season and
 * excludes waivers, two-ways and conversions, so a missing record is not
 * evidence a move never happened — those posts are marked `unrecorded`, and
 * the UI must say "no transaction on record", never "never happened".
 *
 * `npm run verify:outcomes -- --dry`
 */

/** A rumor older than this with nothing on record gets the soft label. */
const STALE_DAYS = 45;

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");

  // Every published post with its primary player and team set, split by
  // whether it came from the transaction log or from a news feed.
  const rows = await db.execute(sql`
    select r.id, r.headline, r.type, r.status, r.published_at,
           s.slug as source_slug,
           (select p.slug from rumor_players rp join players p on p.id = rp.player_id
             where rp.rumor_id = r.id and rp.is_primary limit 1) as player,
           (select string_agg(t.abbreviation, ',' order by t.abbreviation)
              from rumor_teams rt join teams t on t.id = rt.team_id
             where rt.rumor_id = r.id) as teams
    from rumors r join sources s on s.id = r.source_id
    where r.is_published
  `);

  type Row = {
    id: number;
    headline: string;
    type: string;
    status: string;
    published_at: string;
    source_slug: string;
    player: string | null;
    teams: string | null;
  };
  const all = rows.rows as unknown as Row[];

  const transactions = all.filter((r) => r.source_slug === "bbref-transactions");
  const reports = all.filter((r) => r.source_slug !== "bbref-transactions");

  console.log(
    `${all.length} posts · ${transactions.length} from the transaction log · ${reports.length} from news feeds`,
  );

  // Index transactions by player for a cheap lookup.
  const byPlayer = new Map<string, Row[]>();
  for (const t of transactions) {
    if (!t.player) continue;
    byPlayer.set(t.player, [...(byPlayer.get(t.player) ?? []), t]);
  }

  const now = Date.now();
  let confirmed = 0;
  let unrecorded = 0;
  const samples: string[] = [];

  for (const r of reports) {
    if (!r.player) continue;
    const reportedAt = new Date(r.published_at).getTime();

    const match = (byPlayer.get(r.player) ?? []).find((t) => {
      const txAt = new Date(t.published_at).getTime();
      // The transaction has to come after the report, and share a team —
      // otherwise a later unrelated move would "confirm" the rumor.
      if (txAt < reportedAt - 36e5) return false;
      const rTeams = new Set((r.teams ?? "").split(",").filter(Boolean));
      const tTeams = (t.teams ?? "").split(",").filter(Boolean);
      return tTeams.length === 0 || tTeams.some((x) => rTeams.has(x));
    });

    if (match) {
      confirmed++;
      if (samples.length < 6) {
        const days = Math.round(
          (new Date(match.published_at).getTime() - reportedAt) / 864e5,
        );
        samples.push(
          `  CONFIRMED after ${days}d — ${r.headline.slice(0, 56)}\n      by: ${match.headline.slice(0, 56)}`,
        );
      }
      if (!dryRun) {
        await db
          .update(rumors)
          .set({
            outcome: "confirmed",
            outcomeRumorId: match.id,
            outcomeAt: new Date(match.published_at),
          })
          .where(eq(rumors.id, r.id));
      }
      continue;
    }

    // Only speculative posts get the soft negative; a completed report that
    // simply predates our log is not "unrecorded", it is just unmatched.
    const isSpeculative = r.status === "rumor" || r.status === "reported";
    const ageDays = (now - reportedAt) / 864e5;
    if (isSpeculative && ageDays > STALE_DAYS) {
      unrecorded++;
      if (!dryRun) {
        await db
          .update(rumors)
          .set({ outcome: "unrecorded", outcomeRumorId: null, outcomeAt: null })
          .where(eq(rumors.id, r.id));
      }
    }
  }

  console.log(`\n  confirmed by the transaction log: ${confirmed}`);
  console.log(`  speculative and unrecorded after ${STALE_DAYS}d: ${unrecorded}`);
  if (samples.length) console.log(`\n${samples.join("\n")}`);
  if (dryRun) console.log("\n(dry run — nothing written)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
