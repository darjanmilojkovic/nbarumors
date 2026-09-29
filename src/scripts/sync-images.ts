import { config } from "dotenv";
config({ path: ".env.local" });
import { isNotNull } from "drizzle-orm";

/**
 * Download every headshot and team mark we reference, resize them, and record
 * which ones we hold in a manifest the app reads at render time.
 *
 *   npm run sync:images -- --dry
 *   npm run sync:images
 *   npm run sync:images -- --force   # re-encode files already cached
 *
 * Safe to re-run: a file already on disk is skipped unless --force, so the
 * usual run only fetches what is new.
 *
 * This deliberately writes NOTHING to the database.
 *
 * It used to repoint players.headshot_url at /headshots/... as it went, and
 * that took the live site's images down. The database is shared with
 * production, so the rewrite reached the deployed site the instant it ran,
 * while the image files it promised existed only on the machine that ran it.
 * Every headshot and logo 404'd until the columns were put back.
 *
 * Hence the manifest. The path is derived from the NBA id at render time and
 * only for ids listed in src/lib/cached-images.ts, which is generated here and
 * committed next to the files it describes. Code, manifest and images ship in
 * one deploy and cannot disagree — there is no ordering to get right and no
 * window where one is ahead of the other.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const force = process.argv.includes("--force");

  const { writeFile, readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { db } = await import("@/db");
  const { players, teams } = await import("@/db/schema");
  const { cacheHeadshot, cacheTeamLogo } = await import("@/lib/images");

  const teamRows = await db
    .select({ nbaTeamId: teams.nbaTeamId, abbr: teams.abbreviation })
    .from(teams);

  const logoIds: string[] = [];
  const logoMisses: string[] = [];
  for (const t of teamRows) {
    const ok = dryRun ? true : await cacheTeamLogo(t.nbaTeamId, { force });
    if (ok) logoIds.push(t.nbaTeamId);
    else logoMisses.push(t.abbr);
  }
  console.log(
    `  logos: ${logoIds.length}/${teamRows.length}${logoMisses.length ? ` · missing ${logoMisses.join(", ")}` : ""}`,
  );

  /*
   * Every player carrying an NBA id. A player whose id arrived from the daily
   * discovery cron has no cached file yet, and is exactly the row this exists
   * to fill.
   */
  const playerRows = await db
    .select({ nbaPlayerId: players.nbaPlayerId, name: players.fullName })
    .from(players)
    .where(isNotNull(players.nbaPlayerId));

  /*
   * `--refresh` re-checks every player, not just the ones with no file.
   *
   * The NBA replaces photos — a new season's, a new team's uniform, or a real
   * photo where it first served its grey stand-in — and a file we already hold
   * was never looked at again. The weekly job runs with this flag. The
   * prebuild on Vercel does not, so deploys stay quick.
   *
   * headshot-sources.json holds the md5 of each CDN original we last stored.
   * An original that has not changed writes nothing, so the commit carries
   * only the photos that really changed rather than 1,200 re-encoded files.
   */
  const refresh = process.argv.includes("--refresh");
  const sourcesFile = join(process.cwd(), "src", "lib", "headshot-sources.json");
  const sources: Record<string, string> = JSON.parse(
    await readFile(sourcesFile, "utf8").catch(() => "{}"),
  );

  const ids = [...new Set(playerRows.map((p) => p.nbaPlayerId!).filter(Boolean))];
  const names = new Map(playerRows.map((p) => [p.nbaPlayerId!, p.name]));
  const tally: Record<string, number> = {};
  const misses: string[] = [];
  const changed: string[] = [];

  let cursor = 0;
  await Promise.all(
    Array.from({ length: refresh ? 8 : 1 }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        if (dryRun) continue;
        const r = await cacheHeadshot(id, {
          force: force || refresh,
          knownSourceMd5: force ? undefined : sources[id],
        });
        tally[r.status] = (tally[r.status] ?? 0) + 1;
        if (r.sourceMd5) sources[id] = r.sourceMd5;
        // No image on the CDN for this id — the card falls back to the silhouette.
        if (r.status === "missing") misses.push(names.get(id) ?? id);
        if (r.status === "photo" && refresh) changed.push(names.get(id) ?? id);
      }
    }),
  );

  console.log(`  headshots: ${ids.length} players · ${JSON.stringify(tally)}`);
  if (changed.length) {
    console.log(
      `  new or changed photos (${changed.length}): ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? " …" : ""}`,
    );
  }
  if (misses.length) {
    console.log(
      `  no CDN image (${misses.length}): ${misses.slice(0, 8).join(", ")}${misses.length > 8 ? " …" : ""}`,
    );
  }

  if (dryRun) {
    console.log("\n(dry run — nothing downloaded, no manifest written)");
    return;
  }

  await writeFile(
    sourcesFile,
    JSON.stringify(Object.fromEntries(Object.entries(sources).sort()), null, 0) + "\n",
  );

  /*
   * The manifest is a listing of the directories, not a record of what this
   * run managed to download.
   *
   * That distinction is the safety property. This also runs as a prebuild step
   * on Vercel, where a blocked or flaky cdn.nba.com would fail every fetch —
   * and a manifest built from download successes would then come out empty and
   * blank every image on the site, which is the exact outage this design
   * exists to prevent. Reading the directory instead means the committed files
   * are always listed, a failed fetch simply adds nothing, and the worst case
   * is a new player waiting a deploy for his photo.
   */
  const onDisk = async (dir: string, ext: string) => {
    try {
      const names = await readdir(join(process.cwd(), "public", dir));
      return names.filter((n) => n.endsWith(ext)).map((n) => n.slice(0, -ext.length)).sort();
    } catch {
      return [];
    }
  };
  /*
   * Minus the NBA's stand-in. For a player it has no photo of, the CDN answers
   * 200 with a generic grey silhouette, so the fetch "succeeds" — 154 of 1,270
   * cached files were that one image on 29 Sep 2026. Listed, it made the
   * player look photographed: the card's fall-back-to-logos rule never fired
   * and he showed differently from a player with no file at all.
   *
   * The files stay on disk, left out of the manifest, and the UI draws
   * public/silhouette.webp for every player without a photo. cacheHeadshot
   * recognises the stand-in on the raw download and writes an exact copy of
   * that file, so the byte match here does not depend on sharp's version.
   */
  const silhouette = await readFile(join(process.cwd(), "public", "silhouette.webp"));
  const { createHash } = await import("node:crypto");
  const headshotFiles = await onDisk("headshots", ".webp");
  const haveHeadshots: string[] = [];
  const byContent = new Map<string, number>();
  let standIns = 0;
  for (const id of headshotFiles) {
    const bytes = await readFile(join(process.cwd(), "public", "headshots", `${id}.webp`));
    if (bytes.equals(silhouette)) {
      standIns++;
      continue;
    }
    haveHeadshots.push(id);
    const h = createHash("md5").update(bytes).digest("hex");
    byContent.set(h, (byContent.get(h) ?? 0) + 1);
  }
  console.log(`  headshots: ${standIns} of ${headshotFiles.length} files are the NBA stand-in, not listed`);
  /*
   * Real photos are all different, so many players sharing one file means the
   * NBA has changed its stand-in and NBA_STAND_IN_MD5 in lib/images no longer
   * catches it. Warned rather than guessed at: GitHub shows ::warning lines on
   * the run.
   */
  const [, shared = 0] = [...byContent].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (shared > 5) {
    console.log(
      `::warning::${shared} listed headshots are byte-identical — probably a new NBA stand-in. Update NBA_STAND_IN_MD5 and public/silhouette.webp.`,
    );
  }
  const haveLogos = await onDisk("logos", ".svg");

  const manifest = [
    "/*",
    " * GENERATED by `npm run sync:images` — do not edit by hand.",
    " *",
    " * The ids we hold a resized image for, under public/headshots and",
    " * public/logos. lib/images turns an id into a path only if it is listed",
    " * here, so a page can never request a file this deploy does not carry.",
    " */",
    "",
    `export const CACHED_HEADSHOTS: ReadonlySet<string> = new Set(${JSON.stringify(
      haveHeadshots,
    )});`,
    "",
    `export const CACHED_LOGOS: ReadonlySet<string> = new Set(${JSON.stringify(
      haveLogos,
    )});`,
    "",
  ].join("\n");

  await writeFile(join(process.cwd(), "src", "lib", "cached-images.ts"), manifest);
  console.log(
    `\n  wrote src/lib/cached-images.ts — ${haveHeadshots.length} headshots, ` +
      `${haveLogos.length} logos on disk. Commit it with public/.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
