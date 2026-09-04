import type { MetadataRoute } from "next";
import { db } from "@/db";
import { rumors } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { playersForSitemap, teamsForSitemap } from "@/lib/queries";
import { SITE } from "@/lib/site";

/*
 * Rendered per request, not cached.
 *
 * This carried `revalidate = 3600` and did not revalidate at all. On 4 Sep
 * 2026 the live sitemap held 737 posts against 819 in the database, its newest
 * lastmod frozen at 2026-08-31T06:05:54Z — the build time of the deploy before
 * it. Four days of posts, invisible to a crawler except through internal
 * links, with nothing to notice: a stale sitemap throws no error.
 *
 * In Next 16 sitemap.ts is a Route Handler that is cached by default, and the
 * segment `revalidate` was not lifting that here. force-dynamic is the blunt
 * instrument and the right one for this file: four queries and ~240KB per
 * request, against a crawler that asks a few times a day, in exchange for a
 * sitemap that cannot silently freeze again. Revisit only if the numbers here
 * stop being noise.
 */
export const dynamic = "force-dynamic";

/**
 * Every public URL worth crawling, with the date each last changed.
 *
 * Two rules, both learned the hard way and pulling in opposite directions:
 *
 * Do not omit pages that exist. This once filtered players on `is_active`
 * while /players listed anyone with a published post, so 118 pages — Ben
 * Simmons and Kyrie Irving among them — were live, linked from the index and
 * absent here.
 *
 * Do not advertise pages with nothing on them. Fixing the above by sharing
 * /players' query overshot: it returns anyone on a roster OR with a post, and
 * 149 of 674 had no post, so a fifth of the player URLs led to "Nothing on
 * this player yet" wrapped in rails that repeat on every page. Those are
 * noindexed at the page and excluded here, and both flip on together the
 * moment a player picks up a post.
 *
 * lastModified is the signal crawlers actually use; changeFrequency is mostly
 * ignored, so every entry now carries a real date where one exists.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");

  const [rumorRows, teamRows, playerRows] = await Promise.all([
    db
      .select({
        slug: rumors.slug,
        /*
         * The later of the two dates. A post whose body grew when a second
         * outlet corroborated it has changed since publication — 27 have —
         * and sending the original date tells a crawler not to bother.
         */
        updated: sql<Date>`greatest(${rumors.publishedAt}, coalesce(${rumors.bodyUpdatedAt}, ${rumors.publishedAt}))`,
      })
      .from(rumors)
      .where(eq(rumors.isPublished, true)),
    teamsForSitemap(),
    playersForSitemap(),
  ]);

  /** The freshest post anywhere, which is when the feed itself last changed. */
  const newest = rumorRows.reduce<Date | null>((latest, r) => {
    const at = new Date(r.updated);
    return !latest || at > latest ? at : latest;
  }, null);

  return [
    {
      url: base,
      lastModified: newest ?? undefined,
      changeFrequency: "hourly",
      priority: 1,
    },
    { url: `${base}/teams`, changeFrequency: "monthly", priority: 0.6 },
    {
      url: `${base}/players`,
      lastModified: newest ?? undefined,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    ...rumorRows.map((r) => ({
      url: `${base}/rumor/${r.slug}`,
      lastModified: new Date(r.updated),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...teamRows.map((t) => ({
      url: `${base}/team/${t.slug}`,
      lastModified: t.lastPost ? new Date(t.lastPost) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...playerRows.map((p) => ({
      url: `${base}/player/${p.slug}`,
      lastModified: new Date(p.lastPost),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
