/**
 * Single source of truth for the details that appear in legal copy and the
 * footer. These are placeholders — nobody but you can supply the real
 * operating entity, address and contact address, and publishing invented
 * ones would be worse than publishing none.
 */
export const SITE = {
  name: "NBA Rumors",
  domain: "nbarumors.cc",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://nbarumors.cc",

  /** TODO: replace with your registered entity, or delete the line. */
  operator: process.env.NEXT_PUBLIC_OPERATOR ?? "[Operating entity]",
  address: process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "[Registered address]",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "[contact@nbarumors.cc]",

  /** Flip to true only once something actually sets a cookie. */
  usesCookies: false,
  usesAnalytics: false,
} as const;

export const lastUpdated = "25 August 2026";
