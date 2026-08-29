import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Keep `players.current_team_id` tracking where each player actually plays.
 *
 * Nothing owned this column. It was written once by the roster sync, which
 * scraped Basketball-Reference and is now disabled, and never by the publish
 * path — so the directory froze the day that source was turned off. LeBron
 * James still read Los Angeles Lakers a month after a completed signing with
 * Philadelphia, and Anthony Davis read Dallas Mavericks two moves after
 * leaving. 101 players were wrong.
 *
 * Three sources, ranked by date rather than by authority, because the most
 * authoritative is also the slowest:
 *
 *   nba.com's own player index states each club outright. It is the best
 *   answer available and it lags — a signing takes days to appear, so on the
 *   day Jonathan Kuminga agreed terms in Minnesota it still had him in
 *   Atlanta. Written by roster-nba.ts along with the moment it said so.
 *
 *   The NBA transaction feed is official too but inferred from: we take the
 *   latest arrival row and conclude a team. Syncs nightly.
 *
 *   Our own completed posts are immediate and fallible, and only cover players
 *   a story happened to move.
 *
 * Ranking by date means the official roster wins everywhere except the day or
 * so where our own reporting is ahead of it, which for a rumors site is the
 * point rather than a compromise.
 *
 * Recomputed rather than accumulated, so a corrected post or a re-synced
 * transaction heals the row on the next run instead of leaving it stranded.
 */

/** Kinds where the feed's TEAM_ID is the club the player joins. */
const ARRIVAL_KINDS = ["Signing", "Trade", "AwardOnWaivers", "ContractConverted"];

/**
 * How far behind the official roster is assumed to run.
 *
 * Zero, now that it does not have to be assumed.
 *
 * This was seven days, and it was a guess — a correction for the fact that
 * `roster_synced_at` recorded when we ASKED rather than when the league knew.
 * The source it corrected for is gone: the roster now comes from a published
 * snapshot that carries its own build date, and the sync stamps THAT. The lag
 * is measured rather than assumed, so adding a second allowance on top would
 * subtract the same days twice and let a post we got wrong outrank the league
 * for a week.
 *
 * Kept as a named constant rather than deleted because the correction becomes
 * necessary again the moment the roster comes from somewhere that does not date
 * itself.
 */
const ROSTER_LAG_DAYS = 0;

/*
 * Waive is deliberately absent: on that row TEAM_ID names the club letting the
 * player go, so treating it as an arrival would park every waived player at
 * the team that just cut him.
 */
const BEST_TEAM = sql`
  with feed as (
    select distinct on (p.id)
      p.id as player_id, t.id as team_id, tr.occurred_at as at
    from transactions tr
    join players p on p.nba_player_id = tr.nba_player_id
    join teams t on t.nba_team_id = tr.nba_team_id
    where tr.kind in ${ARRIVAL_KINDS}
    order by p.id, tr.occurred_at desc
  ),
  /*
   * Our own completed reporting, taking the destination from the post when the
   * player row does not carry one.
   *
   * rumor_players.to_team_id is only filled when a post moves more than one
   * player; on an ordinary signing the destination lives on the post itself.
   * Reading only the player column therefore threw away most of the evidence
   * we had: of 568 completed posts with a primary player, 70 carried a
   * player-level destination and 484 carried it on the post. DeMar DeRozan
   * signed for Denver in a post dated 21 August and still read Sacramento.
   *
   * The post-level team is used only when there is exactly ONE primary player.
   * A trade names both a from and a to and moves two people in opposite
   * directions, so attributing its destination to everyone in it would send
   * both sides to the same club.
   */
  post_moves as (
    select
      rp.player_id,
      coalesce(
        rp.to_team_id,
        case
          when (
            select count(*) from rumor_players x
            where x.rumor_id = r.id and x.is_primary
          ) = 1 and rp.is_primary
          then (
            select rt.team_id from rumor_teams rt
            where rt.rumor_id = r.id and rt.role = 'to'
            limit 1
          )
        end
      ) as team_id,
      r.published_at as at,
      r.id as rumor_id
    from rumor_players rp
    join rumors r on r.id = rp.rumor_id
    where r.is_published
      and r.status in ('completed', 'confirmed')
  ),
  /*
   * Only rows that actually name a destination.
   *
   * Filtering after the coalesce rather than before it, because a completed
   * post can resolve no team at all — a two-way trade, or a signing whose club
   * was never tagged. Letting those into the ranking made the newest such post
   * win and answer "nowhere": Anthony Davis, Giannis Antetokounmpo and Stephen
   * Curry all lost their club to a later post that named none.
   */
  posts as (
    select distinct on (player_id) player_id, team_id, at
    from post_moves
    where team_id is not null
    order by player_id, at desc, rumor_id desc
  ),
  /*
   * The league's own roster, written onto the player by the roster sync along
   * with the moment it answered — deliberately backdated before it competes.
   *
   * roster_synced_at records when we ASKED, not when the league learned, and
   * those are days apart. Taken at face value a fetch from five minutes ago
   * beats a report from two days ago every time, which is how a post reading
   * "Kuminga reaches 2-year deal with Timberwolves" sat above a masthead
   * saying Atlanta Hawks: the index had not caught up, and won anyway for
   * having been asked recently.
   *
   * Backdating by the lag we actually observe lets our own reporting hold the
   * ground it has earned and no more. A post inside the window is newer than
   * the league's knowledge and takes it; an older one has had long enough to
   * be contradicted, and loses.
   */
  official as (
    select
      id as player_id,
      current_team_id as team_id,
      roster_synced_at - interval '${sql.raw(String(ROSTER_LAG_DAYS))} days' as at
    from players
    where roster_synced_at is not null
  ),
  best as (
    select
      coalesce(o.player_id, f.player_id, s.player_id) as player_id,
      (
        select x.team_id
        from (
          select o.team_id, o.at union all
          select f.team_id, f.at union all
          select s.team_id, s.at
        ) as x
        where x.at is not null
        order by x.at desc
        limit 1
      ) as team_id
    from official o
    full outer join feed f on f.player_id = o.player_id
    full outer join posts s
      on s.player_id = coalesce(o.player_id, f.player_id)
  )
`;

/** Players whose stored club disagrees with the evidence. */
export async function staleCurrentTeams(): Promise<
  { name: string; stored: string | null; shouldBe: string }[]
> {
  const rows = await db.execute(sql`
    ${BEST_TEAM}
    select
      p.full_name as name,
      (select city || ' ' || name from teams where id = p.current_team_id) as stored,
      (select city || ' ' || name from teams where id = best.team_id) as should_be
    from best
    join players p on p.id = best.player_id
    where p.current_team_id is distinct from best.team_id
    order by p.prominence desc
  `);
  return ((rows.rows ?? rows) as unknown as {
    name: string;
    stored: string | null;
    should_be: string;
  }[]).map((r) => ({ name: r.name, stored: r.stored, shouldBe: r.should_be }));
}

/**
 * Write the corrections. Returns how many rows moved.
 *
 * Cheap enough to run at the end of every extraction pass — one statement, and
 * the `is distinct from` means a run with nothing to do writes nothing.
 */
export async function syncCurrentTeams(): Promise<number> {
  const result = await db.execute(sql`
    ${BEST_TEAM}
    update players
       set current_team_id = best.team_id
      from best
     where players.id = best.player_id
       and players.current_team_id is distinct from best.team_id
  `);
  return result.rowCount ?? 0;
}
