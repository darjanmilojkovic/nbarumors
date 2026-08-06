import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { SEED_TEAMS, teamLogoUrl } from "./seed-data/teams";
import { SEED_SOURCES } from "./seed-data/sources";

/** Idempotent: re-running updates rows in place rather than duplicating. */
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const teamRows = SEED_TEAMS.map((t) => ({
    slug: t.slug,
    name: t.name,
    city: t.city,
    abbreviation: t.abbreviation,
    conference: t.conference,
    division: t.division,
    logoUrl: teamLogoUrl(t.nbaTeamId),
    primaryColor: t.primaryColor,
    nbaTeamId: t.nbaTeamId,
  }));

  await db
    .insert(schema.teams)
    .values(teamRows)
    .onConflictDoUpdate({
      target: schema.teams.slug,
      set: {
        name: schema.teams.name,
        city: schema.teams.city,
        logoUrl: schema.teams.logoUrl,
        primaryColor: schema.teams.primaryColor,
      },
    });
  console.log(`seeded ${teamRows.length} teams`);

  await db
    .insert(schema.sources)
    .values(
      SEED_SOURCES.map((s) => ({
        slug: s.slug,
        name: s.name,
        homepageUrl: s.homepageUrl,
        feedUrl: s.feedUrl,
        kind: s.kind,
        enabled: s.enabled,
      })),
    )
    .onConflictDoUpdate({
      target: schema.sources.slug,
      set: {
        feedUrl: schema.sources.feedUrl,
        enabled: schema.sources.enabled,
        name: schema.sources.name,
      },
    });
  console.log(`seeded ${SEED_SOURCES.length} sources`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
