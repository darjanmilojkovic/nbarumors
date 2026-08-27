import { syncTransactions } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pull the NBA's player movement feed, triggered by Vercel Cron.
 *
 * This is the evidence behind every "Confirmed Nd later" badge. It used to be
 * Basketball-Reference, scraped and imported by hand, and it had been frozen
 * since 20 August — which meant the outcome check ran nightly against a table
 * that could not change, and no rumor reported after that date was ever going
 * to be confirmed. The badge was not broken; it was starved.
 *
 * Runs at 23:30, half an hour before the outcome check at midnight, so each
 * night's check reads a feed that already includes the day's moves.
 *
 * Same bearer-token guard as the other crons.
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
    return Response.json(await syncTransactions());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
