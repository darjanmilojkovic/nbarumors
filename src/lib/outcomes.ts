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
 * The same window for a post that already reports the move as done.
 *
 * A completed report is not predicting anything — it is saying this happened —
 * so the league's own record of it should follow within days, not months. Given
 * the longer window these picked up a later, unrelated transaction involving
 * the same player and team: "Seven-team megatrade sends Durant to Houston" was
 * confirmed by Houston re-signing Durant to an extension 105 days on, "Warriors
 * add Charles Bassey on 10-day deal" by a re-signing at 95 days, and "Celtics
 * add Dalano Banton on 10-day deal" by a rest-of-season contract at 51. A
 * 10-day deal becoming a full contract is a different event, and the badge
 * would be dating the report to the wrong one.
 *
 * A week absorbs a weekend and the lag between a deal being agreed and being
 * filed, which is all this needs to cover.
 */
const COMPLETED_WINDOW_DAYS = 7;

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
  nba_player_id: string | null;
  primaries: number;
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
           (select p.nba_player_id from rumor_players rp join players p on p.id = rp.player_id
             where rp.rumor_id = r.id and rp.is_primary limit 1) as nba_player_id,
           (select count(*) from rumor_players rp
             where rp.rumor_id = r.id and rp.is_primary) as primaries,
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
     * A post has to make ONE claim before it can be shown to have come true.
     *
     * "Rumor roundup ties Beal, Harden and LeBron to trade chatter" named
     * three players and predicted nothing about any of them, and was labelled
     * "Confirmed 20d later" because Bradley Beal signed with the Clippers
     * three weeks on. The roundup was not confirmed; a player it mentioned
     * did something.
     */
    const single = Number(r.primaries ?? 0) === 1 && r.nba_player_id;

    /*
     * How long this particular post is allowed to wait for its move.
     *
     * A rumor predicts something and may need weeks to come true; a completed
     * report says it already happened, so the record should follow within
     * days. Using one window for both is what let a year-old signing report be
     * "confirmed" by the same player re-signing with the same team.
     */
    const isSpeculative = r.status === "rumor" || r.status === "reported";
    const windowDays = isSpeculative ? MATCH_WINDOW_DAYS : COMPLETED_WINDOW_DAYS;

    /*
     * The DESTINATION the report named, not every team it mentioned. That
     * roundup put Beal to Boston and mentioned the Clippers in passing; he
     * signed with the Clippers, and matching on any named team called that a
     * confirmation when what the post actually predicted did not happen.
     */
    const wanted = new Set((r.to_team_ids ?? "").split(",").filter(Boolean));

    const match =
      !single || wanted.size === 0
        ? undefined
        : (byPlayer.get(r.nba_player_id as string) ?? []).find((t) => {
            const at = new Date(t.occurred_at).getTime();
            // The move has to follow the report, or it confirms nothing.
            if (at < reportedAt - 36e5) return false;
            // ...and follow it closely enough to be the same event.
            if (at > reportedAt + windowDays * 864e5) return false;
            return t.nba_team_id !== null && wanted.has(t.nba_team_id);
          });

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
