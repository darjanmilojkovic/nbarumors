import type { PlayerImage } from "@/db/schema";
import { CACHED_HEADSHOTS, CACHED_LOGOS } from "@/lib/cached-images";


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

    // Commons sometimes puts boilerplate where the author should be
    // ("This image has been extracted from another file"). That is not a
    // credit, so the image is unusable under CC BY / BY-SA.
    if (/^this (image|file)\b/i.test(artist) || artist.length > 80) continue;

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

/*
 * Self-hosting.
 *
 * Every headshot and logo used to be served straight from cdn.nba.com to the
 * reader's browser. That is someone else's bandwidth paying for our page, and
 * it breaks the day they rename a path, add a referer check or rate-limit us —
 * with no warning and no fallback.
 *
 * It was also slow in a way that is easy to miss. The CDN headshot is a
 * 1040x760 PNG, around 200KB, and the largest we ever draw one is 128px wide.
 * A feed card with four faces pulled down 800KB to paint four thumbnails.
 * Resized to 2x the display size and encoded as WebP the same image is 8KB.
 *
 * So the files are fetched once, resized, and committed under public/. Total
 * weight for all 597 headshots and 30 logos is about 5MB, which is small
 * enough to live in the repo and costs nothing to serve.
 */

/** The CDN original. Used only when downloading, never sent to a browser. */
export const nbaHeadshotSourceUrl = (nbaPlayerId: string) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;

/** The CDN original for a team mark. Download-side only, as above. */
export const nbaLogoSourceUrl = (nbaTeamId: string) =>
  `https://cdn.nba.com/logos/nba/${nbaTeamId}/global/L/logo.svg`;

/** Where a cached headshot is served from. */
export const localHeadshotPath = (nbaPlayerId: string) =>
  `/headshots/${nbaPlayerId}.webp`;

/** Where a cached team mark is served from. */
export const localLogoPath = (nbaTeamId: string) => `/logos/${nbaTeamId}.svg`;

/*
 * 2x the largest size any layout draws a headshot (128x94 on the player page
 * and the four-face stack), so retina screens get a sharp image and nothing
 * downloads pixels it will not use.
 */
const HEADSHOT_W = 256;
const HEADSHOT_H = 188;

/**
 * Fetch, resize and store one headshot. Returns the public path, or null if
 * the CDN has no image for that id.
 *
 * Cropped from the top: these are head-and-shoulders cutouts, and centring the
 * crop cuts the chin off.
 *
 * Callers write the returned path to players.headshot_url only on success, so
 * the column can never point at a file that is not in the deploy — a missing
 * headshot stays null and the card falls back to initials, which is what the
 * 213 players with no NBA id already do.
 */
export async function cacheHeadshot(
  nbaPlayerId: string,
  { force = false } = {},
): Promise<string | null> {
  const { writeFile, mkdir, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const sharp = (await import("sharp")).default;

  const dir = join(process.cwd(), "public", "headshots");
  const file = join(dir, `${nbaPlayerId}.webp`);
  if (!force) {
    try {
      await access(file);
      return localHeadshotPath(nbaPlayerId);
    } catch {
      // Not cached yet; fall through and fetch it.
    }
  }

  const res = await fetch(nbaHeadshotSourceUrl(nbaPlayerId));
  if (!res.ok) return null;

  const resized = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(HEADSHOT_W, HEADSHOT_H, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toBuffer();

  await mkdir(dir, { recursive: true });
  await writeFile(file, resized);
  return localHeadshotPath(nbaPlayerId);
}

/**
 * Fetch and store one team mark. Left as SVG — it is 14KB, it scales, and
 * rasterising it would only make it bigger and worse.
 */
export async function cacheTeamLogo(
  nbaTeamId: string,
  { force = false } = {},
): Promise<string | null> {
  const { writeFile, mkdir, access } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const dir = join(process.cwd(), "public", "logos");
  const file = join(dir, `${nbaTeamId}.svg`);
  if (!force) {
    try {
      await access(file);
      return localLogoPath(nbaTeamId);
    } catch {
      // Not cached yet.
    }
  }

  const res = await fetch(nbaLogoSourceUrl(nbaTeamId));
  if (!res.ok) return null;

  await mkdir(dir, { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return localLogoPath(nbaTeamId);
}

/*
 * Turning an id into a path.
 *
 * These are the only functions the app should use to build an image URL. The
 * manifest is generated alongside the files themselves, so asking it is the
 * same as asking "is this file in the deploy I am running in?" — a question
 * the database cannot answer, because it is shared with every other deploy
 * and with whatever is on a laptop.
 *
 * That is not hypothetical. players.headshot_url once held the answer, a sync
 * on a laptop rewrote all 627 rows to local paths, and production — which had
 * none of the files — served 404s on every headshot and logo on the site until
 * the column was put back.
 */

/** The cached headshot for a player, or null to fall back to initials. */
export const headshotFor = (nbaPlayerId: string | null | undefined) =>
  nbaPlayerId && CACHED_HEADSHOTS.has(nbaPlayerId)
    ? localHeadshotPath(nbaPlayerId)
    : null;

/**
 * The cached mark for a team. Every one of the 30 is committed, so this is
 * non-null in practice and the layouts rely on that — but an id missing from
 * the manifest still returns null rather than a path to nothing.
 */
export const logoFor = (nbaTeamId: string) =>
  CACHED_LOGOS.has(nbaTeamId) ? localLogoPath(nbaTeamId) : null;
