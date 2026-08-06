import { config } from "dotenv";
config({ path: ".env.local" });

/** Local runner: `npm run extract -- 20` (default 50 items). */
async function main() {
  const limit = Number(process.argv[2] ?? 50);
  const { runExtraction } = await import("@/lib/process");
  const r = await runExtraction(limit);

  console.log(`\nmodel: ${r.model}`);
  console.log(`examined ${r.examined} items in ${(r.durationMs / 1000).toFixed(1)}s\n`);
  console.log(`  published: ${r.published}`);
  console.log(`  held (low confidence): ${r.held}`);
  console.log(`  rejected (not transfer news): ${r.rejected}`);
  console.log(`  errors: ${r.errors}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
