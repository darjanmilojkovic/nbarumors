import type { MetadataRoute } from "next";
import { db } from "@/db";
import { rumors, teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { allPlayers } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

/**
 * Every public URL. Rumor pages carry their publish date so crawlers can tell
 * what is new; directories change slowly and say so.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");

  const [rumorRows, teamRows, playerRows] = await Promise.all([
    db
      .select({ slug: rumors.slug, updated: rumors.publishedAt })
      .from(rumors)
      .where(eq(rumors.isPublished, true)),
    db.select({ slug: teams.slug }).from(teams),
    /*
     * The same set /players lists, not `is_active` on its own.
     *
     * Those two answered the same question differently: /players was widened
     * to include anyone carrying a published rumor, and this was left filtering
     * on roster membership. The result was 118 player pages — Ben Simmons and
     * Kyrie Irving among them — live, linked from the index, and absent from
     * the sitemap. Sharing the query is what stops them drifting apart again.
     */
    allPlayers(),
  ]);

  return [
    { url: base, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/teams`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/players`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    ...rumorRows.map((r) => ({
      url: `${base}/rumor/${r.slug}`,
      lastModified: r.updated,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...teamRows.map((t) => ({
      url: `${base}/team/${t.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...playerRows.map((p) => ({
      url: `${base}/player/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
