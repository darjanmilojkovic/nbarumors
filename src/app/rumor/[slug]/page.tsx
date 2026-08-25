import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { rumors } from "@/db/schema";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { latestRumors } from "@/lib/queries";

export const revalidate = 300;

export default async function RumorPage({ params }: PageProps<"/rumor/[slug]">) {
  const { slug } = await params;

  const [row] = await db
    .select({ id: rumors.id })
    .from(rumors)
    .where(eq(rumors.slug, slug))
    .limit(1);
  if (!row) notFound();

  // Small dataset — pull the feed and pick, rather than a second hydrate path.
  const feed = await latestRumors(200);
  const rumor = feed.find((r) => r.id === row.id);
  if (!rumor) notFound();

  const related = feed
    .filter(
      (r) =>
        r.id !== rumor.id &&
        (r.players.some((p) => rumor.players.some((q) => q.slug === p.slug)) ||
          r.teams.some((t) => rumor.teams.some((u) => u.slug === t.slug))),
    )
    .slice(0, 4);

  return (
    <WireShell
      teamSlug={rumor.teams[0]?.slug}
      teamLabel={
        rumor.teams[0] ? `${rumor.teams[0].city} ${rumor.teams[0].name}` : undefined
      }
      playerLabel={rumor.players.find((p) => p.isPrimary)?.fullName}
    >
      <div className="border-x border-rule bg-surface">
        <div className="border-b border-rule px-4 py-3 sm:px-5">
          <Link
            href="/"
            className="font-mono text-[11px] tracking-wider text-muted uppercase hover:text-link"
          >
            ← Back to all updates
          </Link>
        </div>

        <WireItem rumor={rumor} />

        {related.length > 0 && (
          <section>
            <h2 className="display border-b border-rule px-4 py-3 text-[11px] font-bold tracking-[0.13em] text-muted sm:px-5">
              Related rumors
            </h2>
            {related.map((r) => (
              <WireItem key={r.id} rumor={r} />
            ))}
          </section>
        )}
      </div>
    </WireShell>
  );
}
