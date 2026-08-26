import { config } from "dotenv";
config({ path: ".env.local" });
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";

/**
 * Put a body back from a rewrite script's backup file.
 *
 * Every rewrite writes the old rows to JSON first precisely so a bad one can
 * be undone without a database restore.
 *
 *   npm run restore:body -- <backup.json> <slug>
 */
async function main() {
  const [file, slug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rows = JSON.parse(readFileSync(file, "utf8")) as {
    id: string;
    slug: string;
    body: string;
    reportedBy?: string | null;
  }[];
  const row = rows.find((r) => r.slug === slug);
  if (!row) {
    console.error(`${slug} is not in ${file}`);
    process.exitCode = 1;
    return;
  }
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  await db.update(rumors).set({ body: row.body }).where(eq(rumors.id, Number(row.id)));
  console.log(`restored ${slug}:\n  ${row.body}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
