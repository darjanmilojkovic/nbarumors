import { EMPTY_RESULTS, searchSite } from "@/lib/search";

export const runtime = "nodejs";
/*
 * The site is ISR on a 300s revalidate, which is right for a feed and wrong for
 * a search box: a cached response would answer the previous visitor's query.
 */
export const dynamic = "force-dynamic";

/** Long enough for a slow keystroke, short enough to fail fast. */
export const maxDuration = 15;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";

  /*
   * A search box sends a request per keystroke, so a thrown error here is a
   * broken dropdown rather than a broken page. Empty results and a 200 degrade
   * to "no matches", which is the same shape the UI already renders.
   */
  try {
    const results = await searchSite(q);
    return Response.json(results, {
      // Nothing here is per-user, but it is per-query and changes as posts land.
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch {
    return Response.json(EMPTY_RESULTS);
  }
}
