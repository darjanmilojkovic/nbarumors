import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = SITE.url.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Cron endpoints are secret-gated anyway; no reason to advertise them.
      disallow: ["/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
