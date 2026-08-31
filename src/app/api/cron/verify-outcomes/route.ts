import { recordRun } from "@/lib/cron-log";
import { runOutcomeCheck } from "@/lib/outcomes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Outcome check against the transaction log, triggered by Vercel Cron.
 *
 * Without a schedule this ran only when someone typed the command, which meant
 * the "Confirmed Nd later" badge froze at whatever the last manual run decided:
 * a rumour that came true afterwards was never marked, and a mark that stopped
 * holding was never taken down. Six posts carried the badge for weeks on the
 * strength of one run.
 *
 * Daily at midnight UTC, half an hour after the transaction sync at 23:30, so
 * each run reads a feed that already carries the day's moves. The evidence is
 * the NBA's own player movement feed, which updates once a day — anything more
 * frequent would re-read the same rows.
 *
 * Same bearer-token guard as the other crons: it rewrites outcome columns
 * across every published post, so it must not be publicly triggerable.
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
    return Response.json(await recordRun("verify-outcomes", () => runOutcomeCheck()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
