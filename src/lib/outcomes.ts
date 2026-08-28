import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rumors } from "@/db/schema";

/**
 * Check rumors against the league's own record of completed moves.
 *
 * We hold both the rumor stream and the NBA's player movement feed, so a rumor
 * can be marked `confirmed` when the move it called actually landed.
 *
 * The evidence used to be Basketball-Reference's season page: scraped, run
 * through extraction to become posts, and matched to our rumors by player
 * name. All three parts were weak. It was imported by hand and had been frozen
 * since 20 August, so nothing reported after that date could be confirmed at
 * all. Name matching is precisely where "Bobby Portis" and "Bobby Portis Jr."
 * come apart, and we had five such pairs. And every row cost a model call to
 * become a comparison record.
 *
 * The feed carries PLAYER_ID and TEAM_ID, so a confirmation is now an id
 * match against the transactions table, with no extraction and no names.
 *
 * The negative case stays deliberately weak. A missing record is not evidence
 * a move never happened, so those posts are marked `unrecorded` and the card
 * says "no transaction on record", never "never happened".
 */

/** A rumor older than this with nothing on record gets the soft label. */
const STALE_DAYS = 45;

/**
 * How long after a report a move may land and still be that report coming true.
 *
 * Without a limit the check confirms a rumor with next season's paperwork.
 * "Clippers sign Bradley Beal" matched a Clippers-Beal transaction 391 days
 * later, "Rockets sign Jae'Sean Tate" one 383 days later, and six more sat in
 * the same band — every one of them a player re-signing with the same team a
 * year on, which says nothing about whether the original report was right.
 *
 * 120 days covers a deal that takes a full offseason to close while staying
 * far below the ~350-day cluster where the false matches live. Every genuine
 * confirmation measured came in within 17 days, so this is a guard rail rather
 * than a threshold anything currently sits near.
 *
 * Longer than STALE_DAYS on purpose: a post already labelled `unrecorded` is
 * re-examined on every run, so a move that lands late upgrades it to confirmed
 * rather than being locked out by the earlier label.
 */
const MATCH_WINDOW_DAYS = 120;

/**
 * Transaction kinds where TEAM_ID is where the player ARRIVED.
 *
 * Waive is excluded on purpose: there the team is the one letting him go, so
 * treating it as a destination would confirm "Player joins Dallas" with the
 * row recording Dallas cutting him — the opposite of what was reported. Klay
 * Thompson has both in the same week, waived by Dallas on the 21st and signed
 * by Miami on the 23rd, which is exactly the pair that would go wrong.
 */
const ARRIVAL_KINDS = ["Signing", "Trade", "AwardOnWaivers", "ContractConverted"];

export type OutcomeResult = {
  posts: number;
  transactions: number;
  confirmed: number;
  unrecorded: number;
  cleared: number;
  samples: string[];
};

type Row = {
  id: number;
  headline: string;
  status: string;
  published_at: string;
  outcome: string | null;
  primary_ids: string | null;
  to_team_ids: string | null;
};

type Tx = {
  nba_player_id: string;
  nba_team_id: string | null;
  kind: string;
  occurred_at: string;
  description: string;
};

export async function runOutcomeCheck(
  opts: { dryRun?: boolean } = {},
): Promise<OutcomeResult> {
  const dryRun = opts.dryRun ?? false;

  /*
   * Every published post with its primary player's NBA id and the NBA ids of
   * the teams it named as a destination. Both sides of the comparison are ids
   * now, so the join cannot be defeated by a spelling.
   */
  const rows = await db.execute(sql`
    select r.id, r.headline, r.status, r.published_at, r.outcome,
           (select string_agg(p.nba_player_id, ',')
              from rumor_players rp join players p on p.id = rp.player_id
             where rp.rumor_id = r.id and rp.is_primary) as primary_ids,
           (select string_agg(t.nba_team_id, ',')
              from rumor_teams rt join teams t on t.id = rt.team_id
             where rt.rumor_id = r.id and rt.role = 'to') as to_team_ids
    from rumors r
    where r.is_published
  `);

  const reports = (rows.rows ?? rows) as unknown as Row[];

  const txRows = await db.execute(sql`
    select nba_player_id, nba_team_id, kind, occurred_at, description
      from transactions
     where nba_player_id is not null
       and kind in (${sql.join(ARRIVAL_KINDS.map((k) => sql`${k}`), sql`, `)})
  `);
  const txs = (txRows.rows ?? txRows) as unknown as Tx[];

  // Index by player id for a cheap lookup.
  const byPlayer = new Map<string, Tx[]>();
  for (const t of txs) {
    byPlayer.set(t.nba_player_id, [...(byPlayer.get(t.nba_player_id) ?? []), t]);
  }

  const now = Date.now();
  let confirmed = 0;
  let unrecorded = 0;
  let cleared = 0;
  const samples: string[] = [];

  for (const r of reports) {
    const reportedAt = new Date(r.published_at).getTime();

    /*
     * EVERY player the post is about has to have landed, not just one.
     *
     * The guard used to be "exactly one primary", written to stop a roundup
     * claiming a confirmation: "Rumor roundup ties Beal, Harden and LeBron to
     * trade chatter" named three players, predicted nothing about any of them,
     * and was labelled "Confirmed 20d later" because Beal signed with the
     * Clippers three weeks on.
     *
     * But that refuses honest multi-player reports too. "Warriors add Georges
     * Niang and Brandon Williams on one-year deals" names two players; the NBA
     * recorded both signings to Golden State, on the 25th and the 26th. Every
     * claim the post made came true and it still could not be confirmed.
     *
     * Requiring ALL of them keeps the roundup out — only Beal of those three
     * moved, so it fails — while letting a report that named two moves be
     * confirmed once both are on record.
     */
    const primaryIds = (r.primary_ids ?? "").split(",").filter(Boolean);

    // Governs both outcomes: a post is eligible for each, or for neither.
    const isSpeculative = r.status === "rumor" || r.status === "reported";

    /*
     * The DESTINATION the report named, not every team it mentioned. That
     * roundup put Beal to Boston and mentioned the Clippers in passing; he
     * signed with the Clippers, and matching on any named team called that a
     * confirmation when what the post actually predicted did not happen.
     */
    const wanted = new Set((r.to_team_ids ?? "").split(",").filter(Boolean));

    /*
     * The arrival for one player, or undefined.
     *
     * The lower bound is a full day, not an hour. The feed dates every
     * transaction at midnight UTC of the day it happened — there is no time
     * component — so a move recorded on the 25th carries 25 Aug 00:00 while
     * the report of it was published at 23:10 that evening. With an hour of
     * tolerance the record appeared to PRECEDE the story by 23 hours and was
     * thrown out. A day of slack is the smallest window that survives the
     * feed's own precision.
     */
    const arrivalFor = (playerId: string) =>
      (byPlayer.get(playerId) ?? []).find((t) => {
        const at = new Date(t.occurred_at).getTime();
        if (at < reportedAt - 864e5) return false;
        // ...and close enough afterwards to be the same event.
        if (at > reportedAt + MATCH_WINDOW_DAYS * 864e5) return false;
        return t.nba_team_id !== null && wanted.has(t.nba_team_id);
      });

    /*
     * Only a post that PREDICTED something can be confirmed.
     *
     * A completed report already carries the "Done deal" badge, so a second
     * badge saying the league agrees is the same fact twice. It is also almost
     * always the same day: of 456 completed posts with a matching arrival, 433
     * were recorded within 24 hours of us publishing, which would have put
     * "Confirmed 0d later" on two-thirds of the site. A label that never varies
     * is wallpaper, which is exactly why the old "single outlet" badge came out.
     *
     * That leaves the badge doing one job: a rumour we ran turned out to be
     * right. Rare on purpose — three posts today — and worth something when it
     * appears.
     */
    const arrivals =
      !isSpeculative || primaryIds.length === 0 || wanted.size === 0
        ? []
        : primaryIds.map(arrivalFor);

    /*
     * All or nothing, and the badge dates from the LAST one to land — the post
     * is only true once every move it named is on record.
     */
    const allLanded = arrivals.length > 0 && arrivals.every(Boolean);
    const match = allLanded
      ? arrivals
          .filter((a): a is Tx => Boolean(a))
          .reduce((latest, a) =>
            new Date(a.occurred_at) > new Date(latest.occurred_at) ? a : latest,
          )
      : undefined;

    if (match) {
      confirmed++;
      if (samples.length < 8) {
        const days = Math.round(
          (new Date(match.occurred_at).getTime() - reportedAt) / 864e5,
        );
        samples.push(
          `CONFIRMED after ${days}d — ${r.headline.slice(0, 52)} (${match.description.slice(0, 48)})`,
        );
      }
      if (!dryRun) {
        await db
          .update(rumors)
          .set({
            outcome: "confirmed",
            outcomeAt: new Date(match.occurred_at),
            outcomeRumorId: null,
          })
          .where(eq(rumors.id, r.id));
      }
      continue;
    }

    /*
     * A confirmation that no longer holds is withdrawn. The pass only ever
     * wrote outcomes and never cleared them, so a label set by an earlier and
     * looser rule survived every later run that disagreed with it. A claim on
     * the page has to be re-earned each time, or tightening the rule fixes
     * nothing already published.
     */
    if (r.outcome === "confirmed") {
      cleared++;
      if (!dryRun) {
        await db
          .update(rumors)
          .set({ outcome: null, outcomeRumorId: null, outcomeAt: null })
          .where(eq(rumors.id, r.id));
      }
    }

    const ageDays = (now - reportedAt) / 864e5;
    if (isSpeculative && ageDays > STALE_DAYS) {
      unrecorded++;
      if (!dryRun) {
        await db
          .update(rumors)
          .set({ outcome: "unrecorded", outcomeRumorId: null, outcomeAt: null })
          .where(eq(rumors.id, r.id));
      }
    }
  }

  return {
    posts: reports.length,
    transactions: txs.length,
    confirmed,
    unrecorded,
    cleared,
    samples,
  };
}
