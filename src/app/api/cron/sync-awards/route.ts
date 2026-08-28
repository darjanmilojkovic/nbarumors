import { syncAwards } from "@/lib/awards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refresh the career half of prominence, triggered by Vercel Cron.
 *
 * The awards endpoint answers one player at a time, so a full sweep of the
 * league would outlast an invocation. Each run takes a slice — players never
 * read first, then the least recently read — and the rest rotate through on
 * following days. Awards change a handful of times a season, so nothing is
 * lost by a player waiting a day for their first rating.
 *
 * Same bearer-token guard as the other crons.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await syncAwards(200));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
