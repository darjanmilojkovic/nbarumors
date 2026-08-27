import type { NextConfig } from "next";

/*
 * No remotePatterns: every image the site renders is served from public/.
 * Headshots and team marks are fetched from cdn.nba.com by
 * `npm run sync:images`, resized, and committed — see lib/images for why.
 * Adding a host back here is what re-enables hotlinking, so don't, unless
 * that is the intent.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
