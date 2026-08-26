/**
 * Fetch the article behind a feed item, for the outlets whose feeds are
 * teasers.
 *
 * Measured over 30 days, ESPN gives us 133 characters an item, Yahoo 121 and
 * CBS 101 — a single sentence, designed to make you click through. Those are
 * also the outlets we weight highest for credibility, so our most trustworthy
 * sources were producing our thinnest posts. Heavy and Fadeaway World need
 * none of this: they publish the whole article in content:encoded.
 *
 * Proven before it was built. The Yahoo item behind "Kuminga said to favor
 * Lakers" carried 86 characters in the feed and 1,665 in the article, and
 * extracting from the article named the reporter, the competing offer, the
 * Doncic pitch and a prior Hawks report, none of which existed in the teaser.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Sources whose items are worth a page fetch.
 *
 * A flag rather than a blanket rule: fetching costs a request, a few seconds
 * of the cron's budget and 3-5x the extraction tokens, so it is only worth it
 * where the feed withholds the story. Sources that already send full text are
 * deliberately absent.
 */
export const FETCH_ARTICLE_SOURCES = new Set([
  "yahoo-nba", // 4/4 of the thin ones, averaging 2,885 chars
  "sportando", // 6/6, averaging 1,893
  "hoops-rumors", // 5/5, averaging 3,053 — its feed truncates mid-story
  "gnews-woj-shams", // headline-only by design; the link resolves to the publisher
]);

/*
 * Deliberately absent, both measured rather than assumed:
 *
 * espn-nba  — 0 of 23. ESPN answers a server-side request with a 1,987-byte
 *             challenge page: HTTP 202, no article markup, no embedded JSON.
 *             It is bot detection, not a paywall, so no amount of header
 *             dressing gets past it. Their teaser stays all we have, which is
 *             a shame given ESPN is the outlet we weight highest.
 * cbs-nba   — 1 of 12, the rest HTTP 406. Not rate limiting: spacing requests
 *             five seconds apart changed nothing.
 */

/**
 * Below this, a feed summary is a teaser rather than a story and the article
 * is worth fetching. Above it, the feed is already telling us enough — RealGM
 * averages 998 characters and needs no help.
 */
export const THIN_SUMMARY_CHARS = 400;

/** Matches the cap applied to feed text; the facts are near the top. */
const MAX_ARTICLE_CHARS = 4000;

/** Refuse to read an entire homepage into memory looking for paragraphs. */
const MAX_HTML_BYTES = 3_000_000;

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Pull the prose out of a news page.
 *
 * Strip what is never article text, then keep the paragraphs: an article body
 * is <p> elements, while navigation, ad slots and related-links rails are divs
 * and lists. Short fragments are dropped, which removes captions, bylines,
 * cookie notices and social prompts without needing a rule per site.
 */
export function articleText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");

  const paragraphs: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const text = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;|&rsquo;|&apos;/gi, "'")
      // Hex entities too: Yahoo writes apostrophes as &#x27;, and a decimal
      // -only pattern left "he&#x27;ll" scattered through the text.
      .replace(/&#x?[0-9a-f]+;|&\w+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 60) paragraphs.push(text);
  }
  return paragraphs.join("\n\n").slice(0, MAX_ARTICLE_CHARS);
}

/**
 * Turn a news.google.com link into the publisher's own URL.
 *
 * Google News stores an opaque id, not the article address: the base64 payload
 * carries no URL, and the interstitial resolves itself in JavaScript, so
 * fetching it server-side returns Google's shell.
 *
 * The page's own resolver can be called directly, but only with a signature
 * and timestamp minted for that article — they sit on the c-wiz element as
 * data-n-a-sg and data-n-a-ts. Sending placeholders, which is what the widely
 * posted version of this does, returns an empty result.
 *
 * This is an internal endpoint with no stability promise. Everything here
 * fails to null rather than throwing, and the caller falls back to the feed
 * text, so the day Google changes the shape we lose detail and nothing else.
 */
export async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  const id = url.split("/articles/")[1]?.split("?")[0];
  if (!id) return null;

  try {
    const page = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!page.ok) return null;
    const html = await page.text();
    const ts = html.match(/data-n-a-ts="(\d+)"/)?.[1];
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    if (!ts || !sig) return null;

    const payload = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      id,
      Number(ts),
      sig,
    ]);

    const res = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
      {
        method: "POST",
        headers: {
          "user-agent": UA,
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          "f.req": JSON.stringify([[["Fbv4je", payload, null, "generic"]]]),
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;

    const hit = (await res.text()).match(/https?:\\?\/\\?\/(?!news\.google)[^"\\]+/);
    return hit ? hit[0].replace(/\\\//g, "/") : null;
  } catch {
    return null;
  }
}

export type ArticleFetch =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Never throws. A page that 403s, times out, sits behind a consent wall or
 * turns out to be a video stub must leave the item to be extracted from its
 * teaser, not drop it from the wire.
 */
export async function fetchArticle(url: string): Promise<ArticleFetch> {
  /*
   * A Google News link points at an interstitial. Trade it for the
   * publisher's own URL first; without that there is nothing to read.
   */
  if (/(^|\.)news\.google\.com/i.test(new URL(url).hostname)) {
    const real = await resolveGoogleNewsUrl(url);
    if (!real) return { ok: false, reason: "could not resolve google news link" };
    url = real;
  }

  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { ok: false, reason: `content-type ${type}` };

    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_HTML_BYTES) return { ok: false, reason: "page too large" };

    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    const text = articleText(html);

    /*
     * A short extraction means the selectors found navigation rather than an
     * article — a paywall, a consent wall or a video page. The teaser is more
     * honest than three paragraphs of cookie policy.
     */
    if (text.length < 300) {
      return { ok: false, reason: `only ${text.length} chars of prose` };
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message.slice(0, 60) };
  }
}

/**
 * The text extraction should read, given what the feed carried and where it
 * came from. Falls back to the feed summary on any failure.
 */
export async function bestText(item: {
  url: string;
  rawSummary: string | null;
  sourceSlug: string;
}): Promise<{ text: string | null; fetched: boolean; reason?: string }> {
  const summary = item.rawSummary ?? "";
  if (!FETCH_ARTICLE_SOURCES.has(item.sourceSlug)) {
    return { text: item.rawSummary, fetched: false, reason: "source not flagged" };
  }
  if (summary.length >= THIN_SUMMARY_CHARS) {
    return { text: item.rawSummary, fetched: false, reason: "feed text already sufficient" };
  }

  const got = await fetchArticle(item.url);
  if (!got.ok) return { text: item.rawSummary, fetched: false, reason: got.reason };
  // Keep the teaser too: it is occasionally a cleaner statement of the news
  // than the article's opening paragraph, and it costs almost nothing.
  return { text: summary ? `${summary}\n\n${got.text}` : got.text, fetched: true };
}
