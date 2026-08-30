import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Remove attributions to the outlet the card already names.
 *
 * "Miami's 15th roster spot has three paths, per Heavy" is a Heavy item, and
 * the card prints Heavy directly above the sentence. The prompt now forbids
 * this, but a generation change only reaches posts extracted after it, and 33
 * published posts already carry one.
 *
 * DELIBERATELY DETERMINISTIC, not a model rewrite. The clause is a fixed
 * shape and deleting it is a smaller, more auditable change than handing a
 * correct paragraph back to a model and hoping only that clause moves. The
 * previous attempt at a prose backfill — placing reporters' names — damaged 4
 * of the 5 posts it touched, so anything a regex cannot do cleanly is
 * reported and skipped rather than guessed at.
 *
 * Three shapes are handled, and only where the sentence still reads without
 * the clause:
 *
 *   "According to CBS Sports, a blockbuster deal..."  -> recapitalise
 *   "...agreed a two-way deal, according to RealGM."  -> drop the clause
 *   "...cleared for a fifth season, per RealGM."      -> drop the clause
 *
 * Skipped, with the reason printed:
 *
 *   "per Yahoo Sports and NBC Sports" — names another outlet too, so the
 *   clause is doing real work and cannot simply be cut.
 *   "according to Basketball-Reference's transaction log" — names the KIND of
 *   record, which the prompt separately asks for. Not redundant.
 *   "CBS Sports reports that..." — the outlet is the subject of the verb, so
 *   removing it leaves no sentence. Needs a rewrite, not a deletion.
 *
 *   npx tsx src/scripts/fix-self-citation.ts --dry
 *   npx tsx src/scripts/fix-self-citation.ts --apply
 */

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

type Verdict =
  | { kind: "auto"; next: string; how: string }
  | { kind: "skip"; why: string };

export function stripSelfCitation(body: string, outlet: string): Verdict | null {
  const n = outlet.replace(RE_SPECIAL, "\\$&");

  /* Names a second outlet in the same clause — the words are load-bearing. */
  if (new RegExp(`(per|according to)\\s+(the\\s+)?${n}\\s+and\\b`, "i").test(body))
    return { kind: "skip", why: "cites another outlet in the same clause" };

  /*
   * "Basketball-Reference's transaction log" names the record, not just us.
   *
   * Both possessives, and both apostrophes. Checking only `'s` let "per Hoops
   * Rumors' tracker" through, and the clause rule then ate the name and left
   * "six second-rounders unsigned' tracker". A plural masthead takes the bare
   * apostrophe, and this site is full of them — Hoops Rumors, CBS Sports,
   * Yahoo Sports.
   */
  if (new RegExp(`${n}['’]s?\\s+\\w+`, "i").test(body))
    return { kind: "skip", why: "names the kind of record, not just the masthead" };

  /* Outlet as the subject of a verb: deleting it leaves no sentence. */
  if (new RegExp(`\\b${n}\\s+(reports|reported|says|said|notes|noted)\\b`, "i").test(body))
    return { kind: "skip", why: "outlet is the subject of the verb; needs a rewrite" };

  /* "According to X, the deal..." at the start of a sentence. */
  const lead = new RegExp(`(^|(?<=[.!?]\\s))According to (the )?${n},\\s+(\\w)`, "g");
  if (lead.test(body)) {
    return {
      kind: "auto",
      next: body.replace(
        new RegExp(`(^|(?<=[.!?]\\s))According to (the )?${n},\\s+(\\w)`, "g"),
        (_m, pre: string, _the: string, first: string) => pre + first.toUpperCase(),
      ),
      how: "dropped the opening clause and recapitalised",
    };
  }

  /* ", per X" / ", according to X" mid-sentence or before a full stop. */
  const clause = new RegExp(`,?\\s+(per|according to)\\s+(the\\s+)?${n}\\b`, "gi");
  if (clause.test(body)) {
    return {
      kind: "auto",
      next: body.replace(clause, ""),
      how: "dropped the trailing clause",
    };
  }

  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { outletName } = await import("@/lib/extract");
  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  const posts = rows<{
    id: number;
    body: string;
    source_name: string;
    publisher: string | null;
  }>(
    await db.execute(sql`
      select r.id, r.body, s.name source_name,
             (select rs.publisher from rumor_sources rs
               where rs.rumor_id = r.id and rs.publisher is not null limit 1) publisher
      from rumors r join sources s on s.id = r.source_id
      where r.is_published
      order by r.id`),
  );

  let auto = 0;
  let skipped = 0;

  for (const p of posts) {
    const outlet = outletName(p.publisher, p.source_name);
    if (!outlet || outlet.length < 3) continue;
    const v = stripSelfCitation(p.body, outlet);
    if (!v) continue;

    if (v.kind === "skip") {
      skipped++;
      console.log(`SKIP #${p.id} [${outlet}] — ${v.why}`);
      continue;
    }

    /* Guards: never let a "fix" mangle or shrink a body meaningfully. */
    if (v.next === p.body) continue;
    if (v.next.length < p.body.length - outlet.length - 20) {
      skipped++;
      console.log(`SKIP #${p.id} [${outlet}] — removed more than the clause`);
      continue;
    }
    if (/\s,|\s\.|,,|\.\.|\s['’]\s|\w['’]\s+\w+:/.test(v.next)) {
      skipped++;
      console.log(`SKIP #${p.id} [${outlet}] — left broken punctuation`);
      continue;
    }
    /*
     * A later "the outlet"/"the report" pointed at the clause just removed.
     * The card still names the source, so it is not broken, but it is a
     * judgement call rather than a mechanical deletion.
     */
    if (/\b[Tt]he (outlet|report|piece)\b/.test(v.next)) {
      skipped++;
      console.log(`SKIP #${p.id} [${outlet}] — later text refers back to "the outlet"`);
      continue;
    }

    auto++;
    const at = p.body.search(new RegExp(`(per|according to)\\s+(the\\s+)?${outlet.replace(RE_SPECIAL, "\\$&")}`, "i"));
    const from = Math.max(0, at - 70);
    console.log(`\n#${p.id} [${outlet}] ${v.how}`);
    console.log(`  before: …${p.body.slice(from, at + 70).replace(/\n/g, " ")}…`);
    const at2 = Math.max(0, at - 70);
    console.log(`  after : …${v.next.slice(at2, at2 + 140).replace(/\n/g, " ")}…`);

    if (apply) {
      await db.update(rumors).set({ body: v.next }).where(eq(rumors.id, p.id));
      console.log("  written");
    }
  }

  console.log(`\nwould change: ${auto}    skipped for judgement: ${skipped}`);
  if (!apply) console.log("dry run — pass --apply to write");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
