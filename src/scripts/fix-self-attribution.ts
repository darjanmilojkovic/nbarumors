import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Rewrite posts whose summary credits the outlet printed on their own card.
 *
 * `namesOwnOutlet` now sends these back for one retry at extraction, but a
 * rule change only reaches items extracted after it. 23 of 600 published posts
 * already read this way - "A hypothetical framework floated by Heavy would
 * send...", "...according to Heavy." - and nothing would ever revisit them.
 *
 * Only the credit is wrong, so only the credit is removed. The model is given
 * the existing body and asked to drop the self-citation, keeping every fact,
 * figure, name and sentence otherwise intact. That is a far narrower request
 * than re-extracting, which would rewrite copy that is not wrong and would
 * cost the full extraction price on each.
 *
 * Defaults to the three posts the change was raised on. Pass slugs to widen
 * it, or --all to sweep every post the check flags.
 *
 *   npx tsx src/scripts/fix-self-attribution.ts --dry
 *   npx tsx src/scripts/fix-self-attribution.ts --apply
 *   npx tsx src/scripts/fix-self-attribution.ts --all --dry
 */
const DEFAULT_SLUGS = [
  "trade-pitch-sends-podziemski-to-washington-for-bub-carrington-picks-104086",
  "trade-idea-reunites-lakers-with-lopez-adds-jones-for-hardy-laravia-knecht-104455",
  "four-team-pitch-reunites-durant-with-curry-and-warriors-92157",
];

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  const named = argv.filter((a) => !a.startsWith("--"));
  const slugs = named.length ? named : DEFAULT_SLUGS;

  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { namesOwnOutlet, opensWithOutlet, outletName, SCHEMA } = await import("@/lib/extract");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const res = await db.execute(sql`
    select r.id, r.slug, r.headline, r.body, f.publisher, s.name as source_name
      from rumors r
      join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.is_published ${all ? sql`` : sql`and r.slug in (${sql.join(slugs.map((x) => sql`${x}`), sql`, `)})`}
     order by r.published_at desc`);
  type Post = {
    id: number;
    slug: string;
    headline: string;
    body: string;
    publisher: string | null;
    source_name: string;
    outlet: string;
  };
  const candidates: Post[] = ((res.rows ?? res) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    headline: String(r.headline),
    body: String(r.body),
    publisher: (r.publisher as string | null) ?? null,
    source_name: String(r.source_name),
    outlet: outletName(r.publisher as string | null, String(r.source_name)),
  }));

  /* Only rows the live check actually flags, so a sweep cannot touch a post
   * that is already correct. A named slug that does not flag is reported
   * rather than silently skipped: it usually means it was already fixed. */
  const posts = candidates.filter((p) =>
    namesOwnOutlet(p.body, [p.outlet, p.publisher, p.source_name]),
  );
  for (const p of candidates) {
    if (!posts.includes(p)) console.log(`${p.slug} does not name ${p.outlet} - skipping`);
  }
  console.log(`${posts.length} post(s) to rewrite\n`);
  if (!posts.length) return;

  if (apply) {
    const file = `self-attribution-${Date.now()}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        posts.map((p) => ({ id: String(p.id), slug: p.slug, body: p.body })),
        null,
        2,
      ),
    );
    console.log(`old values saved to ${file}`);
    console.log(`undo with: npm run restore:body -- ${file} <slug>\n`);
  }

  let changed = 0;
  for (const post of posts) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { body: SCHEMA.properties.body },
            required: ["body"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            `This summary appears on a card that already prints "${post.outlet}" directly above it, as a link.`,
            ``,
            `The summary credits ${post.outlet} anyway - "floated by ${post.outlet}", "according to ${post.outlet}", "per ${post.outlet}" or similar. Remove that credit. The words tell the reader nothing they cannot already see, and they read as though we were citing somebody else.`,
            ``,
            `Do not replace it with another source. If the summary credits a DIFFERENT outlet or a named reporter anywhere, leave that credit exactly as it is. If it credits nobody once ${post.outlet} is gone, that is correct: a conditional verb already tells the reader this has not happened, so "A trade idea would send..." needs no source at all.`,
            ``,
            `Change nothing else. Keep every fact, figure, name, sentence and paragraph break. Do not re-order, re-word or shorten anything beyond the credit itself and whatever grammar the removal requires.`,
            ``,
            `Headline: ${post.headline}`,
            ``,
            `Summary:`,
            post.body,
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      console.log(`${post.slug} SKIPPED (no text block)`);
      continue;
    }
    const next = (JSON.parse(text.text) as { body: string }).body;

    /*
     * Refuse a rewrite that failed to remove the credit, cut the post down,
     * or echoed the scaffolding back. The last is not hypothetical: an earlier
     * fix script returned "Headline: ... Summary: ..." as a body, which would
     * have written the prompt's own labels onto the page.
     */
    const names = [post.outlet, post.publisher, post.source_name];
    const stillWrong = namesOwnOutlet(next, names) || opensWithOutlet(next, names);
    const shrank = next.length < post.body.length * 0.75;
    const echoed = /^\s*(headline|summary)\s*:/i.test(next) || /\n\s*Summary\s*:/i.test(next);
    if (stillWrong || shrank || echoed) {
      const why = stillWrong ? "still names the outlet" : echoed ? "echoed the scaffolding" : "shrank";
      console.log(`${post.slug} SKIPPED (${why})`);
      console.log(`   ${next.slice(0, 110)}\n`);
      continue;
    }

    console.log(post.slug);
    console.log(`   before: ${post.body.slice(0, 110)}`);
    console.log(`   after : ${next.slice(0, 110)}\n`);
    if (apply) {
      await db.update(rumors).set({ body: next }).where(eq(rumors.id, post.id));
      changed++;
    }
  }

  console.log(apply ? `${changed} post(s) updated` : "dry run - pass --apply to write");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
