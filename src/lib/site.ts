/**
 * Single source of truth for the details that appear in legal copy and the
 * footer.
 *
 * These are hard-coded rather than env-only on purpose: they are public facts
 * about who runs the site, not secrets, and an unset variable on some future
 * environment would silently put "[Operating entity]" in the footer of the
 * terms page. The env vars still override, so a staging deploy can differ.
 */
export const SITE = {
  name: "NBA Rumors",
  domain: "nbarumors.cc",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://nbarumors.cc",

  operator: process.env.NEXT_PUBLIC_OPERATOR ?? "Melomel AB",
  address:
    process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ??
    "Lodjursstråket 1, 417 51 Göteborg, Sweden",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "darjan@melomel.com",

  /** Flip to true only once something actually sets a cookie. */
  usesCookies: true,
  usesAnalytics: true,

  /*
   * Ads are planned, not live. Both branches of the copy are written, so
   * switching this on is what publishes the advertising sections of the
   * privacy policy and the terms — do it in the same change that puts the ad
   * tag on the page, not before, and name the network in `adProvider` first.
   * A policy describing advertising that is not running is as wrong as one
   * that stays silent about advertising that is.
   */
  usesAds: false,
  adProvider: null as string | null,
} as const;

/*
 * Dated per document, because they change on different days — they happen to
 * match today only because analytics and the consent banner touched both.
 * `lastUpdated` is the terms date; privacy has its own below.
 */
export const lastUpdated = "9 September 2026";
export const privacyLastUpdated = "9 September 2026";
