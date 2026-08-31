import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * What each cron last did, and whether it did it.
 *
 * The question this answers used to be unanswerable: on a quiet night a sync
 * inserts nothing, so "ran and found nothing" and "never fired" left the same
 * trace — none. See the cron_runs comment in db/schema.
 *
 *   npx tsx src/scripts/cron-health.ts
 */
async function main() {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const rows = <T,>(r: unknown): T[] => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  const runs = rows<{ name: string; started_at: string; ok: boolean | null; duration_ms: number | null; detail: string | null }>(
    await db.execute(sql`
      select distinct on (name) name, started_at::text, ok, duration_ms, detail
      from cron_runs order by name, started_at desc`));

  if (!runs.length) {
    console.log("no runs recorded yet — the table is new; crons will fill it as they fire");
    return;
  }
  for (const r of runs) {
    const state = r.ok === null ? "NEVER FINISHED" : r.ok ? "ok" : "FAILED";
    console.log(`${r.name.padEnd(20)} ${r.started_at.slice(0, 19)}  ${state.padEnd(14)} ${r.duration_ms ?? "?"}ms`);
    if (r.detail) console.log(`  ${r.detail.slice(0, 150)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
