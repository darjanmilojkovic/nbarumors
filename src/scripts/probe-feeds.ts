import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Judge a candidate feed on the only thing that turned out to matter: how much
 * it tells us BEYOND the headline.
 *
 * A feed whose description repeats the title and appends the outlet name —
 * which is exactly what Google News gives us — produces one-sentence posts no
 * matter how good the extraction prompt is. 39% of our editorial posts arrive
 * that way, and they are the ones that read as padding.
 *
 *   npm run probe:feeds
 */
const CANDIDATES: [string, string][] = [
  ["Bleacher Report", "https://bleacherreport.com/articles/feed?tag_id=19"],
  ["Sports Illustrated", "https://www.si.com/.rss/nba/"],
  ["NBC Sports", "https://www.nbcsports.com/nba/rss"],
  ["heavy.com", "https://heavy.com/sports/nba/feed/"],
  ["Fadeaway World", "https://fadeawayworld.net/feed"],
  ["ClutchPoints", "https://clutchpoints.com/feed"],
  ["Yardbarker NBA", "https://www.yardbarker.com/rss/sport/2"],
  ["SB Nation NBA", "https://www.sbnation.com/rss/nba/index.xml"],
  ["Sporting News", "https://www.sportingnews.com/us/rss"],
  ["Athlon Sports NBA", "https://athlonsports.com/.rss/full/nba"],
  ["Basketball Network", "https://www.basketballnetwork.net/.rss/full/"],
  ["The Sports Rush", "https://thesportsrush.com/nba-feed/"],
  ["Sportskeeda NBA", "https://www.sportskeeda.com/feed/nba"],
  ["NBA.com", "https://www.nba.com/rss/nba_rss.xml"],
];

const clean = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#\d+;|&\w+;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pull one element's text out of a block by hand.
 *
 * Building the pattern with `new RegExp` and a template literal quietly ate
 * the backslashes — `[\s\S]` became `[sS]` — so every field came back empty
 * and every candidate feed scored zero. Indexing sidesteps the escaping
 * entirely.
 */
function tag(block: string, name: string): string {
  const open = block.indexOf(`<${name}`);
  if (open === -1) return "";
  const start = block.indexOf(">", open);
  const end = block.indexOf(`</${name}>`, start);
  if (start === -1 || end === -1) return "";
  return clean(block.slice(start + 1, end));
}

function items(xml: string): string[] {
  const out: string[] = [];
  for (const name of ["item", "entry"]) {
    let i = 0;
    for (;;) {
      const open = xml.indexOf(`<${name}`, i);
      if (open === -1) break;
      const close = xml.indexOf(`</${name}>`, open);
      if (close === -1) break;
      out.push(xml.slice(open, close));
      i = close + 1;
    }
    if (out.length) break;
  }
  return out;
}

async function probe(name: string, url: string) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return console.log(`${name.padEnd(20)} HTTP ${res.status}`);
    const xml = await res.text();
    const list = items(xml);
    if (!list.length) return console.log(`${name.padEnd(20)} OK but 0 items`);

    const extra = list.map((it) => {
      const title = tag(it, "title");
      const full = tag(it, "content:encoded");
      let desc = tag(it, "description") || tag(it, "summary");
      if (desc.toLowerCase().startsWith(title.toLowerCase())) desc = desc.slice(title.length);
      // The post-footer WordPress appends is not editorial content.
      desc = desc.replace(/The post .* appeared first on .*/i, "").trim();
      return { desc: desc.length, full: full.length };
    });
    const med = (pick: (e: { desc: number; full: number }) => number) =>
      extra.map(pick).sort((a, b) => a - b)[Math.floor(extra.length / 2)];

    console.log(
      `${name.padEnd(20)} ${String(list.length).padStart(3)} items | summary ${String(med((e) => e.desc)).padStart(4)} | full text ${String(med((e) => e.full)).padStart(5)}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(20)} FAILED ${(e as Error).message.slice(0, 50)}`);
  }
}

async function main() {
  console.log("median chars per item, beyond the headline:\n");
  for (const [name, url] of CANDIDATES) await probe(name, url);
}
main();
