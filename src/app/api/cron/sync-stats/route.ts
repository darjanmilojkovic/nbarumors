import { runStatsSync } from "@/lib/stats-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Player prominence refresh, triggered by Vercel Cron.
 *
 * Prominence is the base term of the Top tab's ranking, and it is the only
 * input to that ranking not maintained by the ingest/extract loop — without
 * this the ratings freeze on the day of deploy, and every player who first
 * appears in a rumor sorts as 0 forever.
 *
 * Same bearer-token guard as the other two crons: this hits stats.nba.com and
 * rewrites the whole players table, so it must not be publicly triggerable.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runStatsSync();
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
