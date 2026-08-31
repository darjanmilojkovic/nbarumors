import { recordRun } from "@/lib/cron-log";
import { refreshPlayerImages } from "@/lib/refresh-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 200 players at roughly one Commons request each, with headroom. */
export const maxDuration = 300;

/**
 * Re-resolve missing and wrong player pictures, triggered by Vercel Cron.
 *
 * Monthly rather than nightly: Commons gains photographs slowly, and the
 * backlog this clears — 54 players never retried since their first empty
 * search, plus 137 holding something that is not a photograph of them — is
 * finite. After the first pass a month's worth is a handful.
 *
 * Wikimedia is known reachable from Vercel: `ensurePlayerImage` has been
 * calling it from the extract cron all along, which is where all 428 existing
 * images came from. Unlike the NBA stats endpoints, this needed no probe.
 *
 * Same bearer-token guard as the other crons: it rewrites images and deletes
 * rows, so it must not be publicly triggerable.
 *
 * `?dry=1` reports what it would do without writing, so a production run can
 * be proven before it changes anything.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const limitParam = Number(url.searchParams.get("limit"));

  try {
    const result = await recordRun("refresh-images", () =>
      refreshPlayerImages({
      dryRun: dry,
      ...(Number.isFinite(limitParam) && limitParam > 0
        ? { limit: limitParam }
        : {}),
      }),
    );
    return Response.json({ dryRun: dry, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
