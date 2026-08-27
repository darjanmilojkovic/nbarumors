import { discoverPlayers } from "@/lib/discover-players";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily pass to identify players we only know by name, triggered by Vercel Cron.
 *
 * A player enters the database the moment a rumor names him, with nothing but
 * a name. Until something resolves that name to an NBA id he has no headshot
 * and — before the /players filter was widened — no listing at all. Ben
 * Simmons sat in that state while a post about a Kings GM watching him work
 * out was on the front page.
 *
 * Resolution only ever ran when someone typed `npm run sync:ids`, and only
 * over rostered players, so the ones who most needed it were the ones it never
 * looked at.
 *
 * Images are NOT cached here. This runs on Vercel, where the filesystem is
 * read-only, so there is nowhere to write the resized file. The cron records
 * the id; `npm run sync:images` turns ids into files and into a manifest, and
 * those ship with the next deploy. A player found today shows his initials
 * until then, which is the same fallback he already had.
 *
 * Daily is generous for what this does — a handful of new names a week — but
 * Wikidata is one query and the per-candidate work is a HEAD request.
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
    return Response.json(await discoverPlayers({ cacheImages: false }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
