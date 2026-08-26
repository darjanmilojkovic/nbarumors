import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, inArray, sql } from "drizzle-orm";
import { eventKeySimilarity, isSameEvent, normalizeEventKey } from "@/lib/event-key";

/**
 * Merge posts that describe one event under differently-worded keys.
 *
 * Publishing matched event keys by exact string equality, so an event survived
 * as several posts whenever two outlets spelled it differently. Klay Thompson
 * signing with Miami existed five times; one pair differed only in "." versus
 * "-". publish.ts now compares them properly — this repairs what it already
 * wrote.
 *
 * Deterministic, unlike the model-driven dedupe script: same rules as the live
 * path, so a merge here is a merge the pipeline would make today.
 *
 * Duplicates are unpublished rather than deleted, and every one of them
 * becomes a source on the survivor, so nothing is lost and the outlet count
 * goes up instead of the post count.
 *
 *   npm run merge:events -- --dry    review every merge first
 *   npm run merge:events             apply
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors, rumorSources } = await import("@/db/schema");

  const rows = await db
    .select({
      id: rumors.id,
      slug: rumors.slug,
      headline: rumors.headline,
      eventKey: rumors.eventKey,
      type: rumors.type,
      status: rumors.status,
      confidence: rumors.confidence,
      publishedAt: rumors.publishedAt,
      isPublished: rumors.isPublished,
      sourceId: rumors.sourceId,
      feedItemId: rumors.feedItemId,
      sourceUrl: rumors.sourceUrl,
      reportedBy: rumors.reportedBy,
    })
    .from(rumors)
    .orderBy(rumors.publishedAt);

  /*
   * Key similarity alone is not enough to call two posts one event. On its own
   * it merged "Cavaliers add Meleek Thomas" with "Cavaliers add Thomas
   * Bryant", and "Clippers sign Baba Miller" with "Clippers lock in Jordan
   * Miller" — a shared surname is not a shared player. It also merged
   * "Mavericks buy Ishchenko from Lakers" with "Lakers buy Ishchenko from
   * Bulls", which are two real and separate transactions.
   *
   * So the roster of the story has to match exactly as well: same players,
   * same teams. Those come from our own join tables rather than from the text
   * of the key, and they are what actually identifies a transaction.
   */
  type Tag = { id: number; players: string; teams: string };
  const tagRows = await db.execute(sql`
    select r.id,
      coalesce((select string_agg(distinct p.slug, ',' order by p.slug)
                from rumor_players rp join players p on p.id = rp.player_id
                where rp.rumor_id = r.id), '') players,
      coalesce((select string_agg(distinct t.abbreviation, ',' order by t.abbreviation)
                from rumor_teams rt join teams t on t.id = rt.team_id
                where rt.rumor_id = r.id), '') teams
    from rumors r`);
  const tags = new Map<number, { players: string; teams: string }>();
  for (const t of (tagRows.rows ?? tagRows) as unknown as Tag[]) {
    tags.set(t.id, { players: t.players, teams: t.teams });
  }

  /*
   * Unpublished rows are included so the pass can repair its own earlier runs:
   * a group already collapsed still needs its source rows moved onto the
   * survivor. Every action below is idempotent.
   */
  const live = rows.filter((r) => r.eventKey);
  const WINDOW = 14 * 86_400_000;

  // Source rows still attached to each post, so a half-finished merge is visible.
  type Count = { rumor_id: number; n: number };
  const countRows = await db.execute(
    sql`select rumor_id, count(*)::int n from rumor_sources group by rumor_id`,
  );
  const srcCount = new Map<number, number>();
  for (const c of (countRows.rows ?? countRows) as unknown as Count[]) {
    srcCount.set(c.rumor_id, c.n);
  }

  /*
   * Union-find, so a chain of pairs collapses to one survivor. Klay's five
   * posts are not all pairwise similar — the earliest and the latest share
   * little text — but each links to the next, and they are one event.
   */
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const r of live) parent.set(r.id, r.id);

  const links: string[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i];
      const B = live[j];
      if (A.type !== B.type) continue;
      if (Math.abs(+B.publishedAt - +A.publishedAt) > WINDOW) continue;

      // Same cast, or it is not the same transaction.
      const ta = tags.get(A.id);
      const tb = tags.get(B.id);
      if (!ta?.players || ta.players !== tb?.players) continue;
      if (ta.teams !== tb.teams) continue;

      if (!isSameEvent(A.eventKey!, B.eventKey!)) continue;
      union(A.id, B.id);
      links.push(
        `    ${eventKeySimilarity(A.eventKey!, B.eventKey!).toFixed(2)}  ${A.eventKey}\n           ${B.eventKey}`,
      );
    }
  }

  const groups = new Map<number, typeof live>();
  for (const r of live) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const merges = [...groups.values()].filter((g) => g.length > 1);

  const publishedCount = live.filter((r) => r.isPublished).length;
  console.log(
    `${live.length} keyed posts (${publishedCount} published) · ${merges.length} groups\n`,
  );
  if (links.length) console.log("matched pairs:\n" + links.join("\n") + "\n");

  let removed = 0;
  for (const group of merges) {
    const sorted = [...group].sort((a, b) => +a.publishedAt - +b.publishedAt);
    // The live post wins even when a merged-away sibling is older.
    const keeper = sorted.find((r) => r.isPublished) ?? sorted[0];
    const dupes = sorted.filter((r) => r.id !== keeper.id);
    const stillPublished = dupes.filter((d) => d.isPublished).length;
    const strandedSources = dupes.some((d) => (srcCount.get(d.id) ?? 0) > 0);
    if (!stillPublished && !strandedSources) continue;
    console.log(`  ${dupes.length + 1} → 1  "${keeper.headline}"`);
    for (const d of dupes) console.log(`      + ${d.headline}`);
    removed += stillPublished;
    if (dryRun) continue;

    /*
     * Move the duplicates' source rows onto the keeper rather than inserting
     * copies. Every post already owns a source row for its own feed item, and
     * feed_item_id is unique, so an insert here collided and was dropped by
     * onConflictDoNothing — the merge removed posts while quietly transferring
     * none of their attribution, leaving the survivor still showing one outlet.
     */
    await db
      .update(rumorSources)
      .set({ rumorId: keeper.id })
      .where(
        inArray(
          rumorSources.rumorId,
          dupes.map((d) => d.id),
        ),
      );

    // The firmest status in the group wins: a completed move outranks a rumor.
    const RANK: Record<string, number> = {
      rumor: 0, reported: 1, confirmed: 2, completed: 3, debunked: 4,
    };
    const firmest = sorted.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));

    await db
      .update(rumors)
      .set({
        status: firmest.status,
        eventKey: normalizeEventKey(keeper.eventKey!),
        confidence: Math.min(
          1,
          Math.max(...sorted.map((m) => m.confidence)) + 0.05 * dupes.length,
        ),
      })
      .where(eq(rumors.id, keeper.id));

    // Unpublished, never deleted — the row stays for auditing.
    for (const d of dupes) {
      await db.update(rumors).set({ isPublished: false }).where(eq(rumors.id, d.id));
    }
  }

  console.log(
    `\n${dryRun ? "would remove" : "removed"} ${removed} duplicate posts` +
      `\npublished after: ${publishedCount - (dryRun ? 0 : removed)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
