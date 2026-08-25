import type { MetadataRoute } from "next";
import { db } from "@/db";
import { players, rumors, teams } from "@/db/schema";
import { eq } from "drizzle-orm";
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
    db
      .select({ slug: players.slug })
      .from(players)
      .where(eq(players.isActive, true)),
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
