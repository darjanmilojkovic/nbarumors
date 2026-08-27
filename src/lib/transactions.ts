import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";

/**
 * The NBA's player movement feed: every signing, waiver, trade and conversion
 * the league has recorded since 2015, as JSON, with ids.
 *
 * This replaces the Basketball-Reference season page as the evidence behind a
 * confirmation. That page had to be scraped and imported by hand, and had been
 * frozen since 20 August, which quietly meant no rumor reported after that
 * date could ever be marked confirmed. It also carried no ids, so matching a
 * transaction to a player went through his name.
 *
 * Served straight from the CDN path rather than the stats API proper, which is
 * why a plain server-side request works where stats.nba.com endpoints refuse
 * us. Roughly 4MB, so ask for it compressed.
 */
const FEED_URL =
  "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";

type FeedRow = {
  Transaction_Type: string;
  TRANSACTION_DATE: string;
  TRANSACTION_DESCRIPTION: string;
  TEAM_ID: number | string;
  PLAYER_ID: number | string;
};

export type TransactionSyncResult = {
  fetched: number;
  considered: number;
  inserted: number;
  newest: string | null;
};

/**
 * A row carries no id of its own, so identity is the hash of the fields that
 * make it what it is. Re-syncing the whole feed daily then inserts only what
 * is genuinely new.
 */
const rowId = (r: FeedRow) =>
  createHash("sha1")
    .update(
      [
        r.TRANSACTION_DATE,
        r.Transaction_Type,
        String(r.PLAYER_ID ?? ""),
        String(r.TEAM_ID ?? ""),
        r.TRANSACTION_DESCRIPTION ?? "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 40);

/**
 * Parse a feed date as UTC.
 *
 * The feed sends "2026-08-26T00:00:00" with no zone, and an unzoned string
 * is parsed as LOCAL time. On a laptop at UTC+2 that becomes 25 August at
 * 22:00Z, while the same code on Vercel resolves it to 26 August — the same
 * feed producing different dates depending on where the sync ran. That is not
 * cosmetic here: a confirmation requires the transaction to fall after the
 * report, so a day of drift decides whether a rumor is marked confirmed.
 */
function parseFeedDate(raw: string): Date | null {
  if (!raw) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function syncTransactions(
  opts: { dryRun?: boolean; sinceDays?: number } = {},
): Promise<TransactionSyncResult> {
  const dryRun = opts.dryRun ?? false;
  /*
   * The feed goes back to 2015 and we only need enough history to cover the
   * rumors we hold. A wider window costs nothing on the first run and is
   * ignored on every later one, since existing rows conflict away.
   */
  const sinceDays = opts.sinceDays ?? 730;

  const res = await fetch(FEED_URL, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)",
    },
  });
  if (!res.ok) throw new Error(`player movement feed ${res.status}`);

  const json = (await res.json()) as { NBA_Player_Movement?: { rows?: FeedRow[] } };
  const rows = json.NBA_Player_Movement?.rows ?? [];
  if (rows.length === 0) {
    /*
     * An empty feed is a broken fetch, not a quiet week. Failing here keeps a
     * bad response from being read later as "nothing has happened", which is
     * indistinguishable from "nothing was confirmed".
     */
    throw new Error("player movement feed returned no rows");
  }

  const cutoff = new Date(Date.now() - sinceDays * 864e5);
  const values = rows
    .filter((r) => {
      const at = parseFeedDate(r.TRANSACTION_DATE);
      return at !== null && at >= cutoff;
    })
    .map((r) => ({
      externalId: rowId(r),
      kind: String(r.Transaction_Type ?? "").slice(0, 24),
      occurredAt: parseFeedDate(r.TRANSACTION_DATE) as Date,
      /*
       * PLAYER_ID is 0 on rows that move draft picks rather than people
       * ("Denver Nuggets received draft consideration"). Null, so a join finds
       * nothing rather than matching a player id of zero.
       */
      nbaPlayerId: r.PLAYER_ID && String(r.PLAYER_ID) !== "0" ? String(r.PLAYER_ID) : null,
      nbaTeamId: r.TEAM_ID && String(r.TEAM_ID) !== "0" ? String(r.TEAM_ID) : null,
      description: String(r.TRANSACTION_DESCRIPTION ?? "").slice(0, 2000),
    }));

  const newest =
    values.reduce<Date | null>(
      (max, v) => (!max || v.occurredAt > max ? v.occurredAt : max),
      null,
    )?.toISOString() ?? null;

  if (dryRun) {
    const [have] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions);
    return {
      fetched: rows.length,
      considered: values.length,
      inserted: Math.max(0, values.length - Number(have?.n ?? 0)),
      newest,
    };
  }

  const before = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);

  // Chunked: a single insert of several thousand rows exceeds the parameter limit.
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(transactions)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing({ target: transactions.externalId });
  }

  const after = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);

  return {
    fetched: rows.length,
    considered: values.length,
    inserted: Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0),
    newest,
  };
}
