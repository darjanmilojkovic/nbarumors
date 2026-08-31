import { recordRun } from "@/lib/cron-log";
import { runExtraction } from "@/lib/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Extraction endpoint, triggered by Vercel Cron. Gated on CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    /*
     * Recorded like the nightly jobs, though this one fires 48 times a day
     * rather than once. The reason is `fetched` and `fetchFailures`: whether
     * an outlet's article pages answer a request FROM VERCEL is knowable only
     * here, and until now that answer lived in this response and nowhere else.
     * The Athletic and the New York Post were both added on measurements taken
     * from a laptop, which ESPN and CBS are standing proof means nothing.
     *
     * A fetch failure degrades to the feed teaser rather than erroring, so
     * `ok` stays true and the evidence is in `detail` — which is truncated at
     * 2,000 characters, enough for the counts and the first few failing URLs.
     */
    return Response.json(await recordRun("extract", () => runExtraction(40)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
