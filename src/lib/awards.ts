import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";

/**
 * Career standing, from the league's own record of who won what.
 *
 * This is the career half of prominence. It used to be all-time scoring rank,
 * which could only see points — so a Defensive Player of the Year scored
 * nothing from it, and so did a career playmaker, which are exactly the
 * players a trade rumor is usually about.
 *
 * The per-game half is untouched and still dominant. A rising star leading the
 * league in scoring with no awards at all should rank on that alone, and does.
 *
 * `stats.nba.com/stats/playerawards` is the same surface behind the Awards and
 * Honors section of an nba.com player page. It answers per player, so this
 * runs as a slice rather than a sweep.
 */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

export type Award = {
  description: string;
  season: string | null;
  allNbaTeamNumber: string | null;
};

/**
 * What each honour is worth before recency is applied.
 *
 * Weekly and monthly awards are deliberately near-worthless individually. They
 * are the most numerous rows by far — LeBron James has 68 Player of the Week
 * to 4 MVP — and counting them evenly would rate longevity as greatness.
 */
const WEIGHTS: { match: RegExp; points: number }[] = [
  { match: /^NBA Most Valuable Player$/i, points: 30 },
  { match: /Finals Most Valuable Player/i, points: 22 },
  { match: /Defensive Player of the Year/i, points: 18 },
  { match: /^NBA Champion$/i, points: 14 },
  { match: /^All-NBA$/i, points: 12 },
  { match: /^NBA All-Star$/i, points: 7 },
  { match: /All-Defensive Team/i, points: 6 },
  { match: /Rookie of the Year/i, points: 6 },
  { match: /Most Improved Player|Sixth Man/i, points: 5 },
  { match: /All-Star Most Valuable Player/i, points: 5 },
  { match: /All-Rookie Team/i, points: 2 },
  { match: /Player of the Month/i, points: 1 },
  { match: /Player of the Week/i, points: 0.3 },
];

/** All-NBA First Team is not All-NBA Third Team. */
const TEAM_MULTIPLIER: Record<string, number> = { "1": 1, "2": 0.75, "3": 0.55 };

/**
 * Ratings an honour guarantees, regardless of how long ago it was won.
 *
 * The problem this solves: Carmelo Anthony, a top-ten all-time scorer, sat at
 * 65 and would have fallen to 51, because prominence is mostly season form and
 * he has no season. An honour is a permanent fact about a career and should
 * behave like one.
 *
 * Two tiers rather than one, and that is the whole point. Flooring every
 * honour at 100 would have put a single All-Star selection from 2011 level
 * with Anthony Edwards, and prominence decides feed ranking — so the top would
 * stop being ordered at exactly the point where order matters most. At 85 a
 * one-time All-Star always ranks respectably and never outranks a current
 * star, whose season form carries them past it.
 */
const FLOORS: { match: RegExp; floor: number; requiresFirstTeam?: boolean }[] = [
  { match: /^NBA Most Valuable Player$/i, floor: 100 },
  { match: /Finals Most Valuable Player/i, floor: 100 },
  { match: /Defensive Player of the Year/i, floor: 100 },
  { match: /Scoring (Champion|Title)|Scoring Leader/i, floor: 100 },
  // All-NBA First Team only; second and third fall to the tier below.
  { match: /^All-NBA$/i, floor: 100, requiresFirstTeam: true },
  { match: /^All-NBA$/i, floor: 85 },
  { match: /All-Defensive Team/i, floor: 85 },
  { match: /^NBA All-Star$/i, floor: 85 },
  { match: /Rookie of the Year/i, floor: 85 },
  { match: /Sixth Man/i, floor: 85 },
  { match: /Most Improved/i, floor: 85 },
  { match: /All-Star Most Valuable Player/i, floor: 85 },
];

/** The highest rating any of these honours guarantees. */
export function prominenceFloorFor(awards: Award[]): number {
  let floor = 0;
  for (const a of awards) {
    for (const rule of FLOORS) {
      if (!rule.match.test(a.description)) continue;
      if (rule.requiresFirstTeam && String(a.allNbaTeamNumber) !== "1") continue;
      floor = Math.max(floor, rule.floor);
    }
  }
  return floor;
}

/** Distinct honour names, kept so weights can change without re-reading. */
export function honorNames(awards: Award[]): string[] {
  return [...new Set(awards.map((a) => a.description).filter(Boolean))].sort();
}

/**
 * How much an honour keeps as it ages.
 *
 * Twenty-two All-Star selections ending in 2010 is a different claim about a
 * player than seven ending last season, and this site is about who moves now.
 * Nothing decays to nothing: a former MVP is still a former MVP, and the floor
 * keeps them above a journeyman having a good month.
 */
const HALF_LIFE_YEARS = 9;
const FLOOR = 0.35;

function recencyFactor(season: string | null, now: Date): number {
  const startYear = Number((season ?? "").slice(0, 4));
  if (!Number.isFinite(startYear) || startYear < 1946) return FLOOR;
  const age = Math.max(0, now.getUTCFullYear() - startYear);
  return FLOOR + (1 - FLOOR) * Math.pow(0.5, age / HALF_LIFE_YEARS);
}

/**
 * Fold an award list into 0-35.
 *
 * Compressed with a curve rather than a cap so the top of the league stays
 * separable: LeBron James and Nikola Jokic both exceed any linear ceiling, and
 * a hard clamp would flatten every great player onto the same number.
 */
export function accoladeScore(awards: Award[], now = new Date()): number {
  let raw = 0;
  for (const a of awards) {
    const weight = WEIGHTS.find((w) => w.match.test(a.description));
    if (!weight) continue;
    const team = a.allNbaTeamNumber
      ? (TEAM_MULTIPLIER[String(a.allNbaTeamNumber)] ?? 1)
      : 1;
    raw += weight.points * team * recencyFactor(a.season, now);
  }
  /*
   * The divisor is what separates the top of the league, and the first attempt
   * got it wrong. At 45 the curve saturated so early that LeBron James and
   * Nikola Jokic both scored 35, Chris Paul tied Shai Gilgeous-Alexander, and
   * Rudy Gobert tied Luka Doncic — eleven of fourteen test players landed
   * between 30 and 35, which is not a signal, it is a constant.
   *
   * At 130 a perennial All-Star sits near the middle of the range and only a
   * genuine all-time career approaches the ceiling.
   */
  return Math.round(35 * (1 - Math.exp(-raw / 130)));
}

export async function fetchPlayerAwards(
  nbaPlayerId: string,
  attempt = 0,
): Promise<Award[]> {
  /*
   * A sweep of the league is over a thousand sequential requests and some
   * of them are dropped mid-connection. One backed-off retry turns that
   * from a failed player into a slow one.
   */
  const retry = async (err: unknown) => {
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return fetchPlayerAwards(nbaPlayerId, attempt + 1);
  };
  let res: Response;
  try {
    res = await fetch(
      `https://stats.nba.com/stats/playerawards?PlayerID=${nbaPlayerId}`,
      { headers: HEADERS },
    );
  } catch (err) {
    return retry(err);
  }
  if (!res.ok) throw new Error(`playerawards ${nbaPlayerId}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    resultSets: { headers: string[]; rowSet: unknown[][] }[];
  };
  const set = json.resultSets[0];
  const at = (n: string) => set.headers.indexOf(n);
  const iDesc = at("DESCRIPTION");
  const iSeason = at("SEASON");
  const iTeam = at("ALL_NBA_TEAM_NUMBER");
  if (iDesc < 0) throw new Error("playerawards: no DESCRIPTION column");

  return set.rowSet.map((row) => ({
    description: String(row[iDesc] ?? ""),
    season: iSeason >= 0 && row[iSeason] != null ? String(row[iSeason]) : null,
    allNbaTeamNumber:
      iTeam >= 0 && row[iTeam] != null ? String(row[iTeam]) : null,
  }));
}

export type AwardsSyncResult = {
  attempted: number;
  updated: number;
  failed: number;
  remaining: number;
};

/**
 * Read awards for a slice of players, oldest first.
 *
 * One request each, so the whole league in a single run would outlast a cron
 * invocation. Players never read come first, then the least recently read, so
 * a new name is rated within a day and the rest rotate through.
 */
export async function syncAwards(limit = 150): Promise<AwardsSyncResult> {
  const due = await db
    .select({ id: players.id, nbaPlayerId: players.nbaPlayerId })
    .from(players)
    .where(
      and(
        isNotNull(players.nbaPlayerId),
        or(
          sql`${players.awardsSyncedAt} is null`,
          sql`${players.awardsSyncedAt} < now() - interval '30 days'`,
        ),
      ),
    )
    .orderBy(sql`${players.awardsSyncedAt} nulls first`, asc(players.id))
    .limit(limit);

  let updated = 0;
  let failed = 0;
  const now = new Date();

  for (const p of due) {
    try {
      const awards = await fetchPlayerAwards(String(p.nbaPlayerId));
      await db
        .update(players)
        .set({
          accolades: accoladeScore(awards, now),
          honors: honorNames(awards),
          prominenceFloor: prominenceFloorFor(awards),
          awardsSyncedAt: now,
        })
        .where(eq(players.id, p.id));
      updated++;
    } catch {
      /*
       * Stamp a failure too. Without it one player the endpoint dislikes sits
       * at the head of the queue forever and the rotation never advances.
       */
      failed++;
      await db
        .update(players)
        .set({ awardsSyncedAt: now })
        .where(eq(players.id, p.id));
    }
    // The league does not ask for this, but 150 requests in a burst is rude.
    await new Promise((r) => setTimeout(r, 120));
  }

  const [rest] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(players)
    .where(
      and(
        isNotNull(players.nbaPlayerId),
        or(
          sql`${players.awardsSyncedAt} is null`,
          sql`${players.awardsSyncedAt} < now() - interval '30 days'`,
        ),
      ),
    );

  return { attempted: due.length, updated, failed, remaining: Number(rest.n) };
}
