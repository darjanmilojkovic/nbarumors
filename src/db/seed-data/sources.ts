/**
 * Ingest sources. Each was checked live during setup; item counts in comments
 * are what the feed returned at the time.
 *
 * Google News queries are the widest net — they surface Woj/Shams-style scoops
 * that break on X and get aggregated before the majors publish a feed item.
 */
export type SeedSource = {
  slug: string;
  name: string;
  homepageUrl: string;
  feedUrl: string;
  kind: "rss" | "google_news";
  enabled: boolean;
  note?: string;
};

const googleNews = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

export const SEED_SOURCES: SeedSource[] = [
  {
    slug: "espn-nba",
    name: "ESPN",
    homepageUrl: "https://www.espn.com/nba/",
    feedUrl: "https://www.espn.com/espn/rss/nba/news",
    kind: "rss",
    enabled: true,
  },
  {
    slug: "realgm-wiretap",
    name: "RealGM",
    homepageUrl: "https://basketball.realgm.com/wiretap",
    feedUrl: "https://basketball.realgm.com/rss/wiretap/0/0.xml",
    kind: "rss",
    enabled: true, // ~31 items, highest signal-to-noise for transactions
  },
  {
    slug: "yahoo-nba",
    name: "Yahoo Sports",
    homepageUrl: "https://sports.yahoo.com/nba/",
    feedUrl: "https://sports.yahoo.com/nba/rss.xml",
    kind: "rss",
    enabled: true,
  },
  {
    slug: "cbs-nba",
    name: "CBS Sports",
    homepageUrl: "https://www.cbssports.com/nba/",
    feedUrl: "https://www.cbssports.com/rss/headlines/nba/",
    kind: "rss",
    enabled: true,
  },
  {
    slug: "sportando",
    name: "Sportando",
    homepageUrl: "https://www.sportando.basketball/en",
    feedUrl: "https://www.sportando.basketball/en/feed",
    kind: "rss",
    enabled: true, // international moves, good for signings from abroad
  },
  {
    slug: "hoopshype",
    name: "HoopsHype",
    homepageUrl: "https://hoopshype.com/",
    feedUrl: "https://hoopshype.com/feed/",
    kind: "rss",
    enabled: false,
    note: "Feed 307s to archive.hoopshype.com, which does not resolve. Left registered but disabled; re-enable if the site returns.",
  },
  {
    slug: "gnews-trade-rumors",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA trade rumors"),
    kind: "google_news",
    enabled: true,
  },
  {
    slug: "gnews-signings",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA free agency signing agree deal"),
    kind: "google_news",
    enabled: true,
  },
  {
    slug: "gnews-woj-shams",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA sources tell ESPN trade OR sign"),
    kind: "google_news",
    enabled: true,
  },
];
