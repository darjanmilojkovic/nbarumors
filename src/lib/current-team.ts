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
 * Two sources, and neither is a superset of the other:
 *
 *   The NBA transaction feed is official and broad — it resolves 543 players
 *   against 145 from our own posts — but it syncs once a day, so a signing
 *   reported this afternoon is not in it yet.
 *
 *   Our own completed posts are immediate but sparse, and only cover players
 *   a story happened to move.
 *
 * On the 130 players both can answer they disagree 23 times, and the direction
 * varies: the feed is fresher for Norman Powell, our posts are fresher for
 * Jonathan Kuminga. So neither wins outright — the later date does.
 *
 * Recomputed rather than accumulated, so a corrected post or a re-synced
 * transaction heals the row on the next run instead of leaving it stranded.
 */

/** Kinds where the feed's TEAM_ID is the club the player joins. */
const ARRIVAL_KINDS = ["Signing", "Trade", "AwardOnWaivers", "ContractConverted"];

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
  posts as (
    select distinct on (rp.player_id)
      rp.player_id, rp.to_team_id as team_id, r.published_at as at
    from rumor_players rp
    join rumors r on r.id = rp.rumor_id
    where r.is_published
      and r.status in ('completed', 'confirmed')
      and rp.to_team_id is not null
    order by rp.player_id, r.published_at desc, r.id desc
  ),
  best as (
    select
      coalesce(f.player_id, s.player_id) as player_id,
      case
        when f.at is null then s.team_id
        when s.at is null then f.team_id
        when f.at >= s.at then f.team_id
        else s.team_id
      end as team_id
    from feed f
    full outer join posts s on s.player_id = f.player_id
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
