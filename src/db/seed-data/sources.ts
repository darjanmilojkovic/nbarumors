/**
 * Ingest sources. Each was checked live during setup; item counts in comments
 * are what the feed returned at the time.
 *
 * PREFER AN OUTLET'S OWN FEED. Google News is the widest net and catches
 * scoops early, but it strips the article: its description is the headline
 * repeated with the outlet name appended, and its link is an interstitial
 * rather than the publisher's URL. Measured across our published posts, items
 * arriving that way carried a median of zero characters beyond the headline,
 * against 904 for RealGM's own feed — and they are the posts whose summaries
 * had nothing to say. Only one narrow Google News query is still enabled.
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
    slug: "hoops-rumors",
    name: "Hoops Rumors",
    homepageUrl: "https://www.hoopsrumors.com/",
    feedUrl: "https://www.hoopsrumors.com/feed",
    kind: "rss",
    enabled: true,
    note: "Stands in for HoopsHype, and is a closer fit than it ever was: a dedicated transactions desk rather than a general NBA site, so nearly every item is a signing, trade or contract story rather than a game recap to be rejected.",
  },
  {
    slug: "heavy-nba",
    name: "Heavy",
    homepageUrl: "https://heavy.com/sports/nba/",
    feedUrl: "https://heavy.com/sports/nba/feed/",
    kind: "rss",
    enabled: true,
    note: "Was reaching us through Google News as a bare headline. Its own feed carries the full article in content:encoded — about 4,000 characters against zero.",
  },
  {
    slug: "fadeaway-world",
    name: "Fadeaway World",
    homepageUrl: "https://fadeawayworld.net/",
    feedUrl: "https://fadeawayworld.net/feed",
    kind: "rss",
    enabled: true,
    note: "Same swap as Heavy: full article text in the feed, where Google News gave us the headline twice.",
  },
  {
    slug: "athletic-nba",
    name: "The Athletic",
    homepageUrl: "https://www.nytimes.com/athletic/nba/",
    feedUrl: "https://www.nytimes.com/athletic/rss/nba/",
    kind: "rss",
    enabled: true,
    note: "100 items, three weeks deep. The feed itself is a teaser — 112 characters an item, thinner than ESPN — but the article pages answered a server-side request and returned full text, four of five hitting the 4,000-character cap, paywall included. That is the reason to carry it: reported pieces rather than aggregation. Two cautions. The path is /athletic/rss/nba/; /athletic/nba/rss/ 404s. And the feed lagged two days behind publication when it was checked, so it is not the source to rely on for being early.",
  },
  {
    slug: "nypost-nba",
    name: "New York Post",
    homepageUrl: "https://nypost.com/nba/",
    feedUrl: "https://nypost.com/nba/feed/",
    kind: "rss",
    enabled: true,
    note: "20 items, freshest of anything here — same-day, where The Athletic lagged. Carries content:encoded, but only ~205 characters of it, so the article is still worth a fetch: 5/5 returned 1,650-2,790 characters. Expect the gate to earn its keep. Of the five newest items two were celebrity-adjacent rather than basketball, which is the trade for the freshness.",
  },
  {
    slug: "gnews-trade-rumors",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA trade rumors"),
    kind: "google_news",
    enabled: false,
    note: "Disabled. Google News strips the article: its description repeats the headline and appends the outlet name, so 39% of our editorial posts arrived with nothing to summarize and the model padded them with commentary about the sourcing. Every outlet it surfaced in volume now has a direct feed here. It also hands us a news.google.com interstitial as the source URL rather than the publisher's own.",
  },
  {
    slug: "gnews-signings",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA free agency signing agree deal"),
    kind: "google_news",
    enabled: false,
    note: "Disabled for the same reason as gnews-trade-rumors.",
  },
  {
    slug: "gnews-woj-shams",
    name: "Google News",
    homepageUrl: "https://news.google.com/",
    feedUrl: googleNews("NBA sources tell ESPN trade OR sign"),
    kind: "google_news",
    enabled: true,
    note: "The one Google News query kept. It exists to catch a scoop breaking on X before any outlet files it to a feed, where being early matters more than being detailed. Its items are still headline-only, so they will read short until article fetching lands.",
  },
];
