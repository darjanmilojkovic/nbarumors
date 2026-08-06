import type { PlayerImage } from "@/db/schema";

/**
 * Official NBA headshot. Deterministic from the player id, 1040x760 with a
 * transparent background — the cutout look the mock-up's card uses.
 * Hotlinked, never rehosted.
 */
export const nbaHeadshotUrl = (nbaPlayerId: string) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;

/** Licenses we will publish. Anything else is dropped at ingest. */
const ALLOWED_LICENSES: Record<string, PlayerImage["license"]> = {
  cc0: "cc0",
  "cc by 2.0": "cc_by",
  "cc by 3.0": "cc_by",
  "cc by 4.0": "cc_by",
  "cc by-sa 2.0": "cc_by_sa",
  "cc by-sa 3.0": "cc_by_sa",
  "cc by-sa 4.0": "cc_by_sa",
  "public domain": "public_domain",
};

export type CommonsImage = {
  url: string;
  width: number;
  height: number;
  license: PlayerImage["license"];
  attribution: string;
  attributionUrl: string;
  sourceUrl: string;
};

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

/**
 * Search Wikimedia Commons for usable photos of a player.
 *
 * Only images whose license is on the allowlist AND that carry an artist
 * credit come back — CC BY and CC BY-SA both require attribution, so an
 * image we cannot credit is an image we cannot use.
 */
export async function findCommonsImages(
  playerName: string,
  { limit = 5, width = 1200 } = {},
): Promise<CommonsImage[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: playerName,
    gsrnamespace: "6", // File: namespace
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: String(width),
    format: "json",
    origin: "*",
  });

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)" },
  });
  if (!res.ok) return [];

  type CommonsPage = {
    imageinfo?: {
      url: string;
      thumburl?: string;
      width: number;
      height: number;
      thumbwidth?: number;
      thumbheight?: number;
      descriptionurl: string;
      extmetadata?: Record<string, { value?: string }>;
    }[];
  };

  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = data?.query?.pages ?? {};

  const out: CommonsImage[] = [];
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (!info) continue;

    const meta = info.extmetadata ?? {};
    const rawLicense = stripHtml(meta.LicenseShortName?.value ?? "").toLowerCase();
    const license = ALLOWED_LICENSES[rawLicense];
    if (!license) continue;

    const artist = stripHtml(meta.Artist?.value ?? "");
    if (!artist) continue; // Unattributable — skip it.

    out.push({
      url: info.thumburl ?? info.url,
      width: info.thumbwidth ?? info.width,
      height: info.thumbheight ?? info.height,
      license,
      attribution: `${artist} / ${stripHtml(meta.LicenseShortName?.value ?? "")}`,
      attributionUrl: info.descriptionurl,
      sourceUrl: info.descriptionurl,
    });
  }
  return out;
}

/** Landscape images make better card heroes than portrait ones. */
export const preferLandscape = (a: CommonsImage, b: CommonsImage) =>
  b.width / b.height - a.width / a.height;
