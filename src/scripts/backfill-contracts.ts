import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, isNull, sql } from "drizzle-orm";

/**
 * Pull contract figures out of posts written before the extraction schema
 * carried them.
 *
 * Deliberately regex rather than another model pass: the numbers are already
 * in our own summaries in a narrow set of shapes ("$73 million", "three-year"),
 * so parsing is free, deterministic, and cannot hallucinate a figure that was
 * never reported. New posts get the values straight from extraction.
 */

const WORD_YEARS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

/** "$73 million", "$3.3M", "$1.2 billion" → "$73M". Never invents. */
function parseValue(text: string): string | null {
  const m = text.match(
    /\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion|m\b|bn\b)?/i,
  );
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] ?? "").toLowerCase();

  if (unit.startsWith("b")) return `$${num}B`;
  if (unit.startsWith("m")) return `$${num}M`;
  // A bare "$73" next to contract talk is millions in practice, but guessing
  // is exactly what this parser is meant to avoid.
  return null;
}

function parseYears(text: string): number | null {
  const digit = text.match(/(\d+)[-\s]year/i);
  if (digit) {
    const n = Number(digit[1]);
    return n >= 1 && n <= 10 ? n : null;
  }
  const word = text.match(
    /\b(one|two|three|four|five|six|seven)[-\s]year/i,
  );
  return word ? (WORD_YEARS[word[1].toLowerCase()] ?? null) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");

  const rows = await db
    .select({
      id: rumors.id,
      headline: rumors.headline,
      body: rumors.body,
    })
    .from(rumors)
    .where(isNull(rumors.contractValue));

  let withValue = 0;
  let withYears = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const text = `${r.headline} ${r.body}`;
    const value = parseValue(text);
    const years = parseYears(text);
    if (!value && years === null) continue;

    if (value) withValue++;
    if (years !== null) withYears++;
    if (samples.length < 8) {
      samples.push(
        `  ${(value ?? "—").padEnd(8)} ${String(years ?? "—").padEnd(3)} ${r.headline.slice(0, 58)}`,
      );
    }

    if (!dryRun) {
      await db
        .update(rumors)
        .set({ contractValue: value, contractYears: years })
        .where(eq(rumors.id, r.id));
    }
  }

  console.log(`scanned ${rows.length} posts`);
  console.log(`  with a stated value: ${withValue}`);
  console.log(`  with a stated length: ${withYears}`);
  console.log(`\nvalue  yrs headline`);
  console.log(samples.join("\n"));

  if (!dryRun) {
    const [n] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(rumors)
      .where(sql`${rumors.contractValue} is not null`);
    console.log(`\nposts now carrying a figure: ${n.c}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
