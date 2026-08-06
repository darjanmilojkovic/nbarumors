import { config } from "dotenv";
config({ path: ".env.local" });

/** Local runner: `npm run ingest`. Same code path as the cron route. */
async function main() {
  const { runIngest } = await import("@/lib/ingest");
  const result = await runIngest();

  console.log(`\ningest finished in ${(result.durationMs / 1000).toFixed(1)}s\n`);
  for (const s of result.sources) {
    const status = s.error
      ? `ERROR — ${s.error}`
      : `${s.inserted} new, ${s.duplicates} dupes, ${s.fetched} fetched`;
    console.log(`  ${s.source.padEnd(22)} ${status}`);
  }
  console.log(`\ntotal new items: ${result.totalInserted}\n`);
}

// No process.exit() — the Neon fetch pool is still tearing down, and forcing
// exit on Windows trips a libuv assertion.
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
