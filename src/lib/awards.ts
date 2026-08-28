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

/**
 * How much of its tier an honour still guarantees, by age.
 *
 * A floor that never fades says an All-NBA First Team from 2015 makes the same
 * claim about who matters now as one from 2025. It does not: DeAndre Jordan
 * was floored at 100 on a 2015 selection while averaging 4.4 points, level
 * with Nikola Jokic.
 *
 * Full weight for three years, then straight down to nothing at twelve. The
 * genuine stars lose nothing to this — Kevin Durant's last All-NBA is 2017,
 * but with 30 accolades and 26.6 points his computed rating already reaches
 * 100 and the floor was never doing the work. What falls away is exactly the
 * case being complained about: a role player carrying one decade-old honour.
 */
const FULL_YEARS = 3;
const EXPIRES_AT = 12;

function floorDecay(season: number, nowYear: number): number {
  if (!Number.isFinite(season)) return 0;
  const age = Math.max(0, nowYear - season);
  if (age <= FULL_YEARS) return 1;
  if (age >= EXPIRES_AT) return 0;
  return 1 - (age - FULL_YEARS) / (EXPIRES_AT - FULL_YEARS);
}

/**
 * The highest rating any honour still guarantees.
 *
 * Note that Conference Finals MVP is deliberately in the top tier alongside
 * the Finals award. It began as a regex matching more than it meant to, and
 * was kept on purpose: winning a conference final is a comparable claim on a
 * reader's attention, and this is a site about who matters now rather than a
 * record book.
 */
export function prominenceFloorFor(
  awards: Award[],
  now = new Date(),
): number {
  const nowYear = now.getUTCFullYear();
  let floor = 0;
  for (const a of awards) {
    for (const rule of FLOORS) {
      if (!rule.match.test(a.description)) continue;
      if (rule.requiresFirstTeam && String(a.allNbaTeamNumber) !== "1") continue;
      const season = Number((a.season ?? "").slice(0, 4));
      floor = Math.max(floor, rule.floor * floorDecay(season, nowYear));
    }
  }
  return Math.round(floor);
}

/**
 * The honours, each carrying the season it was won.
 *
 * Stored as "2015|All-NBA" rather than the bare name. The season is what makes
 * the floor recomputable: without it, changing how honours age means reading
 * 1,163 players again, one request each, to recover a number the league had
 * already told us.
 */
export function honorNames(awards: Award[]): string[] {
  return [
    ...new Set(
      awards
        .filter((a) => a.description)
        .map((a) => `${(a.season ?? "").slice(0, 4)}|${a.description}`),
    ),
  ].sort();
}

/** Read back what honorNames wrote, for recomputing without a fetch. */
export function parseHonors(stored: string[]): Award[] {
  return stored.map((s) => {
    const i = s.indexOf("|");
    return i < 0
      ? { description: s, season: null, allNbaTeamNumber: null }
      : {
          description: s.slice(i + 1),
          season: s.slice(0, i) || null,
          allNbaTeamNumber: null,
        };
  });
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

/**
 * Where a player stands on the league's all-time lists.
 *
 * This does not decay, and that is the point. An honour is something that
 * happened in a season and fades as the league moves on; being third on the
 * all-time scoring list is a fact about today, and it stays true whether the
 * player retired last year or in 2003. Carmelo Anthony is a top-ten scorer
 * now, in the present tense.
 *
 * Counting stats only. The endpoint also ranks turnovers, personal fouls and
 * shooting percentages — leading the league in fouls all-time is longevity
 * rather than distinction, and a percentage list is topped by specialists with
 * short careers.
 */
const ALL_TIME_LISTS = [
  "PTSLeaders",
  "REBLeaders",
  "ASTLeaders",
  "STLLeaders",
  "BLKLeaders",
  "FG3MLeaders",
] as const;

/** Top ten on any of those lists, then a step down for the rest of the top twenty. */
function allTimeFloorFor(rank: number): number {
  if (rank <= 10) return 100;
  if (rank <= 20) return 90;
  return 0;
}

export async function fetchAllTimeFloors(): Promise<Map<string, number>> {
  const res = await fetch(
    "https://stats.nba.com/stats/alltimeleadersgrids?LeagueID=00" +
      "&PerMode=Totals&SeasonType=Regular+Season&TopX=20",
    { headers: HEADERS },
  );
  if (!res.ok) throw new Error(`alltimeleadersgrids: HTTP ${res.status}`);
  const json = (await res.json()) as {
    resultSets: { name: string; headers: string[]; rowSet: unknown[][] }[];
  };

  const floors = new Map<string, number>();
  for (const name of ALL_TIME_LISTS) {
    const rs = json.resultSets.find((r) => r.name === name);
    if (!rs) continue;
    const iId = rs.headers.indexOf("PLAYER_ID");
    const iRank = rs.headers.findIndex((h) => /_RANK$/.test(h));
    if (iId < 0 || iRank < 0) continue;
    for (const row of rs.rowSet) {
      const id = String(row[iId]);
      const floor = allTimeFloorFor(Number(row[iRank]));
      if (floor > (floors.get(id) ?? 0)) floors.set(id, floor);
    }
  }
  return floors;
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

  /*
   * One request for the whole run. An all-time standing outranks a decayed
   * honour, so the two are compared rather than added: a top-ten scorer
   * floors at 100 whether or not his last All-NBA has aged out.
   */
  let allTime = new Map<string, number>();
  try {
    allTime = await fetchAllTimeFloors();
  } catch {
    // A missing list costs the standing, not the sweep.
  }

  for (const p of due) {
    try {
      const awards = await fetchPlayerAwards(String(p.nbaPlayerId));
      await db
        .update(players)
        .set({
          accolades: accoladeScore(awards, now),
          honors: honorNames(awards),
          prominenceFloor: Math.max(
            prominenceFloorFor(awards, now),
            allTime.get(String(p.nbaPlayerId)) ?? 0,
          ),
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
