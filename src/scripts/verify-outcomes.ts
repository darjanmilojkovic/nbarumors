import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Local runner for the outcome check. The rule itself lives in lib/outcomes,
 * so the cron and this share one implementation.
 *
 *   npm run verify:outcomes -- --dry
 *   npm run verify:outcomes
 *   npm run verify:outcomes -- --dry --reverify   (ask the model again everywhere)
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { runOutcomeCheck } = await import("@/lib/outcomes");
  const reverify = process.argv.includes("--reverify");
  const r = await runOutcomeCheck({ dryRun, reverify });

  console.log(
    `${r.posts} published posts checked against ${r.transactions} recorded arrivals\n`,
  );
  console.log(`  confirmed by the league's record: ${r.confirmed}`);
  console.log(`  a move landed but did not confirm the claim: ${r.mismatched}`);
  console.log(`  speculative and unrecorded: ${r.unrecorded}`);
  console.log(`  confirmations withdrawn: ${r.cleared}`);
  if (r.samples.length) console.log(`\n${r.samples.map((s) => `  ${s}`).join("\n")}`);
  if (dryRun) console.log("\n(dry run — nothing written)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
