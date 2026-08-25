/**
 * Basketball-Reference's season transaction log — the factual spine.
 *
 * Unlike the RSS feeds, this is a complete dated archive of every move in a
 * season. The markup tags teams with `data-attr-to="PHI"` and links players
 * by name, so teams and players are parsed deterministically rather than
 * inferred, and only the prose summary needs a model.
 */

const TO_NBA: Record<string, string> = {
  BRK: "BKN",
  CHO: "CHA",
  PHO: "PHX",
};

export type Transaction = {
  date: Date;
  text: string;
  teamAbbrevs: string[];
  playerNames: string[];
};

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export async function fetchTransactions(season = 2026): Promise<Transaction[]> {
  const res = await fetch(
    `https://www.basketball-reference.com/leagues/NBA_${season}_transactions.html`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    },
  );
  if (!res.ok) throw new Error(`basketball-reference: HTTP ${res.status}`);
  const html = await res.text();

  const start = html.indexOf("page_index");
  if (start === -1) throw new Error("transaction list not found");
  const segment = html.slice(start, html.indexOf("</ul>", start));

  const out: Transaction[] = [];

  // One <li> per date, holding one or more <p> transactions.
  for (const block of segment.split("<li>").slice(1)) {
    const rawDate = block.match(/<span>([^<]+)<\/span>/)?.[1];
    if (!rawDate) continue;
    const date = new Date(`${rawDate} 12:00:00 UTC`);
    if (Number.isNaN(date.getTime())) continue;

    for (const p of block.split("<p>").slice(1)) {
      const body = p.split("</p>")[0];
      const text = stripTags(body);
      if (!text) continue;

      const teamAbbrevs = [
        ...new Set(
          [...body.matchAll(/data-attr-to="([A-Z]{3})"/g)].map(
            (m) => TO_NBA[m[1]] ?? m[1],
          ),
        ),
      ];

      const playerNames = [
        ...new Set(
          [...body.matchAll(/href="\/players\/[^"]+">([^<]+)</g)].map((m) =>
            m[1].trim(),
          ),
        ),
      ];

      out.push({ date, text, teamAbbrevs, playerNames });
    }
  }

  return out;
}
