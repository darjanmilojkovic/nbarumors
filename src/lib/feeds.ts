import { XMLParser } from "fast-xml-parser";

export type ParsedItem = {
  title: string;
  link: string;
  summary: string | null;
  author: string | null;
  publishedAt: Date;
};

/**
 * Ceiling on the text we keep per item.
 *
 * Every character here is billed on the way into extraction, and a news story
 * front-loads its facts: the terms, the teams and the reporter are in the
 * first few paragraphs, and the rest is background we would not use anyway.
 * Around 4,000 covers a full heavy.com or Fadeaway World article.
 */
const MAX_SUMMARY_CHARS = 4000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Feeds are inconsistent about whether a single-item feed yields an array.
  isArray: (name) => name === "item" || name === "entry",
});

const asText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as never)) {
    return String((v as { "#text": unknown })["#text"] ?? "");
  }
  return String(v);
};

/** Strip tags and collapse whitespace — feed summaries are dirty HTML. */
const clean = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Atom `<link>` is an attribute; RSS `<link>` is text. Handle both. */
function extractLink(entry: Record<string, unknown>): string {
  const link = entry.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alt = link.find(
      (l) => typeof l === "object" && l && (l as never)["@_rel"] !== "self",
    );
    const chosen = alt ?? link[0];
    return typeof chosen === "string"
      ? chosen
      : String((chosen as Record<string, unknown>)?.["@_href"] ?? "");
  }
  if (link && typeof link === "object") {
    return String((link as Record<string, unknown>)["@_href"] ?? asText(link));
  }
  return asText(entry.guid);
}

function extractDate(entry: Record<string, unknown>): Date {
  const raw =
    asText(entry.pubDate) ||
    asText(entry.published) ||
    asText(entry.updated) ||
    asText(entry["dc:date"]);
  const d = new Date(raw);
  // An unparseable date must not become 1970 — that would sort the item to the
  // bottom forever. Treat it as "just seen".
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export class FeedError extends Error {}

/** Fetch and parse one RSS or Atom feed into normalized items. */
export async function fetchFeed(
  feedUrl: string,
  timeoutMs = 20_000,
): Promise<ParsedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let xml: string;
  try {
    const res = await fetch(feedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) throw new FeedError(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    throw err instanceof FeedError
      ? err
      : new FeedError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }

  const doc = parser.parse(xml);
  const entries: Record<string, unknown>[] =
    doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item ?? [];

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new FeedError("no items found — feed shape unrecognized or empty");
  }

  const items: ParsedItem[] = [];
  for (const entry of entries) {
    const title = clean(asText(entry.title));
    const link = extractLink(entry).trim();
    if (!title || !link) continue;

    /*
     * Take the richest field, not the first one present.
     *
     * content:encoded was only a fallback for an empty description, and most
     * WordPress feeds populate both — a one-line teaser in description and the
     * entire article in content:encoded. So heavy.com and Fadeaway World were
     * handing us roughly 4,000 characters per item and we were reading 300 of
     * it, then writing summaries that had nothing to say.
     *
     * Capped, because the whole thing is priced per token on the way into
     * extraction and the facts that matter are near the top of a news story.
     */
    const summary = clean(
      [
        asText(entry.description),
        asText(entry.summary),
        asText(entry["content:encoded"]),
        asText(entry.content),
      ].reduce((best, s) => (s && s.length > best.length ? s : best), ""),
    ).slice(0, MAX_SUMMARY_CHARS);

    items.push({
      title,
      link,
      summary: summary || null,
      author:
        clean(asText(entry["dc:creator"]) || asText(entry.author)) || null,
      publishedAt: extractDate(entry),
    });
  }
  return items;
}
