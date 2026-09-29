/**
 * What a player without a photo shows, everywhere a photo would go.
 *
 * It is the NBA CDN's own stand-in, so a player it has no photo of looks the
 * same as one with no NBA id at all. Chosen over initials on 29 Sep 2026.
 * Kept in its own module so client components can import it without pulling
 * in the headshot manifest.
 */
export const SILHOUETTE = "/silhouette.webp";
