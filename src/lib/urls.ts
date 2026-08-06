import { createHash } from "node:crypto";

/**
 * Tracking parameters that change per-referrer but not per-article. Left in
 * place they would defeat dedupe: the same ESPN story arrives from three
 * feeds with three different `utm_source` values.
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ito$/i,
  /^ex_cid$/i,
  /^smid$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^igshid$/i,
  /^ref$/i,
  /^src$/i,
  /^partner$/i,
  /^platform$/i,
  /^oc$/i, // Google News
];

const isTracking = (key: string) => TRACKING_PARAMS.some((re) => re.test(key));

/**
 * Reduce a URL to a stable identity: lowercase host, no `www.`, no tracking
 * params, no fragment, no trailing slash. Two URLs that canonicalize the same
 * are the same story.
 */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.protocol = "https:";

  for (const key of [...url.searchParams.keys()]) {
    if (isTracking(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  let out = url.toString();
  out = out.replace(/\?$/, "");
  if (url.pathname !== "/" && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Dedupe key. */
export const urlHash = (canonical: string) =>
  createHash("sha256").update(canonical).digest("hex");

const isGoogleNewsLink = (u: string) =>
  /(^|\.)news\.google\.com$/.test(safeHost(u));

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Google News `<link>`s point at a redirector, so every aggregated copy of a
 * story looks unique. Follow the redirect once to recover the publisher URL —
 * that is what collapses the Google copy onto the ESPN original.
 *
 * Best-effort: on any failure we keep the original link rather than drop the
 * item, since a duplicate is cheaper than a missed rumor.
 */
export async function resolveUrl(raw: string, timeoutMs = 10_000): Promise<string> {
  if (!isGoogleNewsLink(raw)) return raw;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(raw, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)" },
    });
    // Google sometimes serves an interstitial rather than a 30x; in that case
    // res.url is still the redirector and we fall through to the original.
    return isGoogleNewsLink(res.url) ? raw : res.url;
  } catch {
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

/** Publisher shown on the card when the item came via an aggregator. */
export function displayDomain(url: string): string {
  const host = safeHost(url);
  return host.replace(/^www\./, "");
}

export const isAggregatorUrl = isGoogleNewsLink;

/**
 * Google News titles are "Headline goes here - The Athletic". Split the outlet
 * off so the headline is clean and we still know who reported it.
 *
 * Only the last " - " is treated as the separator, and only when what follows
 * is short and has no sentence punctuation — headlines contain dashes too
 * ("Lakers-Mavericks trade talks - ESPN").
 */
export function splitAggregatorTitle(title: string): {
  title: string;
  publisher: string | null;
} {
  const idx = title.lastIndexOf(" - ");
  if (idx === -1) return { title, publisher: null };

  const head = title.slice(0, idx).trim();
  const tail = title.slice(idx + 3).trim();

  const looksLikePublisher =
    head.length > 15 && tail.length > 0 && tail.length <= 40 && !/[.!?]$/.test(tail);

  return looksLikePublisher
    ? { title: head, publisher: tail }
    : { title, publisher: null };
}
