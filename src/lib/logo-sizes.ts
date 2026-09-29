/*
 * The sizes a layout draws a team logo at, in CSS pixels: the /teams row and
 * /players group header, the rumor card tile, and the team page masthead
 * (which also covers its 40px mobile size).
 *
 * Each is rendered from the SVG at exactly 2x and lightly sharpened (see
 * cacheTeamLogo). At these sizes the browser's own SVG rendering came out
 * softer — judged side by side on all 30 marks, 29 Sep 2026. The SVG stays on
 * disk as the source.
 *
 * Kept in its own module so client components can import it without pulling
 * in the headshot manifest.
 */
export const LOGO_SIZES = [24, 36, 56] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];

/**
 * The raster for a logo URL at one display size. Takes the URL logoFor gave,
 * so a null (not in the deploy) stays null. Revert to plain SVG by returning
 * `logoUrl` unchanged.
 */
export const logoAt = <T extends string | null | undefined>(logoUrl: T, size: LogoSize) =>
  (logoUrl ? logoUrl.replace(/\.svg$/, `-${size}.webp`) : logoUrl) as T;

/*
 * The link-preview image for a team: a square PNG, because Facebook, X, Slack
 * and LinkedIn all refuse an SVG og:image. The logo is baked onto the site's
 * light plate rather than left transparent — a preview is drawn on whatever
 * the app's background is, and on a dark-mode feed the Spurs would vanish
 * exactly as they did on our own black plate.
 */
export const LOGO_SHARE_PX = 512;

export const logoShare = (logoUrl: string | null | undefined) =>
  logoUrl ? logoUrl.replace(/\.svg$/, "-share.png") : null;
