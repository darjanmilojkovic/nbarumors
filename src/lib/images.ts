import type { PlayerImage } from "@/db/schema";
import { CACHED_HEADSHOTS, CACHED_LOGOS } from "@/lib/cached-images";
import { LOGO_SHARE_PX, LOGO_SIZES } from "@/lib/logo-sizes";


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
/**
 * md5 of the CDN's own stand-in PNG, the grey silhouette it answers 200 with
 * for a player it has no photo of (12,430 bytes; the same for ids 1622,
 * 1643764 and 76442 on 29 Sep 2026).
 *
 * Recognised on the raw download rather than after resizing, because the
 * resized bytes depend on the installed sharp and a runner's could differ from
 * a laptop's. If the NBA ever changes its stand-in this stops matching, and
 * sync-images warns when many players share one file.
 */
const NBA_STAND_IN_MD5 = "e7f284977a4931dedd1cb6ba4c32283e";

export type HeadshotResult = {
  /**
   * photo: a new or changed photo was written. stand-in: the NBA has none and
   * the silhouette was written. unchanged: re-fetched, same as last time,
   * nothing written. cached: not fetched, a file exists. missing: the fetch
   * failed; any existing file is left alone.
   */
  status: "photo" | "stand-in" | "unchanged" | "cached" | "missing";
  /** md5 of the CDN original, whenever one was downloaded. */
  sourceMd5?: string;
};

/**
 * Fetch and store one headshot.
 *
 * With `force`, fetch even when a file exists; pass the source md5 recorded
 * last time as `knownSourceMd5` and an unchanged original writes nothing. That
 * is what lets the weekly job re-check every player — picking up a new
 * season's photo, or a real photo replacing the stand-in — while committing
 * only the files that actually changed.
 *
 * A stand-in is stored as an exact copy of public/silhouette.webp, which is
 * what keeps it out of the manifest (see sync-images).
 */
export async function cacheHeadshot(
  nbaPlayerId: string,
  { force = false, knownSourceMd5 }: { force?: boolean; knownSourceMd5?: string } = {},
): Promise<HeadshotResult> {
  const { writeFile, mkdir, readFile, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const sharp = (await import("sharp")).default;

  const dir = join(process.cwd(), "public", "headshots");
  const file = join(dir, `${nbaPlayerId}.webp`);
  const exists = await access(file).then(() => true, () => false);
  if (exists && !force) return { status: "cached" };

  const res = await fetch(nbaHeadshotSourceUrl(nbaPlayerId)).catch(() => null);
  if (!res?.ok) return { status: "missing" };
  const raw = Buffer.from(await res.arrayBuffer());
  const sourceMd5 = createHash("md5").update(raw).digest("hex");

  if (exists && sourceMd5 === knownSourceMd5) return { status: "unchanged", sourceMd5 };

  await mkdir(dir, { recursive: true });
  if (sourceMd5 === NBA_STAND_IN_MD5) {
    await writeFile(file, await readFile(join(process.cwd(), "public", "silhouette.webp")));
    return { status: "stand-in", sourceMd5 };
  }

  const resized = await sharp(raw)
    .resize(HEADSHOT_W, HEADSHOT_H, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(file, resized);
  return { status: "photo", sourceMd5 };
}

/**
 * Fetch and store one team mark: the SVG, plus a WebP per LOGO_SIZES rendered
 * from it. A raster is (re)written whenever it is missing or the SVG was just
 * fetched, so the two can never drift and an existing cache gains the rasters
 * on the next run without a --force.
 */
export async function cacheTeamLogo(
  nbaTeamId: string,
  { force = false } = {},
): Promise<string | null> {
  const { writeFile, mkdir, access, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const dir = join(process.cwd(), "public", "logos");
  const file = join(dir, `${nbaTeamId}.svg`);
  const exists = await access(file).then(() => true, () => false);

  let fetched = false;
  if (force || !exists) {
    const res = await fetch(nbaLogoSourceUrl(nbaTeamId));
    if (!res.ok) return null;
    await mkdir(dir, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    fetched = true;
  }

  const sharp = (await import("sharp")).default;
  /*
   * The NBA draws each mark with margins inside its own canvas — a round badge
   * fills about 75% of it — so the empty edge is cut off before sizing, and
   * every mark fills its box the same way whatever the original padding.
   */
  const rendered = await sharp(await readFile(file), { density: 600 })
    .resize(1024, 1024, { fit: "inside" })
    .png()
    .toBuffer();
  const svg = await sharp(rendered).trim({ threshold: 1 }).png().toBuffer();
  for (const size of LOGO_SIZES) {
    const out = join(dir, `${nbaTeamId}-${size}.webp`);
    if (!fetched && (await access(out).then(() => true, () => false))) continue;
    const px = size * 2;
    const webp = await sharp(svg)
      .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
      .sharpen({ sigma: 0.5 })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer();
    await writeFile(out, webp);
  }

  const shareOut = join(dir, `${nbaTeamId}-share.png`);
  if (fetched || !(await access(shareOut).then(() => true, () => false))) {
    const inner = Math.round(LOGO_SHARE_PX * 0.8);
    const mark = await sharp(svg)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const png = await sharp({
      create: { width: LOGO_SHARE_PX, height: LOGO_SHARE_PX, channels: 3, background: "#e8e8e8" },
    })
      .composite([{ input: mark, gravity: "centre" }])
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    await writeFile(shareOut, png);
  }
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

/** The cached headshot for a player, or null to fall back to the silhouette. */
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
