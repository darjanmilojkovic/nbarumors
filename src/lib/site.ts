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
  usesCookies: false,
  usesAnalytics: false,
} as const;

export const lastUpdated = "25 August 2026";
