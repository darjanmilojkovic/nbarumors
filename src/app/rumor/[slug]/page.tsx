import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { rumorSources, rumors } from "@/db/schema";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { surname } from "@/lib/names";
import { latestRumors, rumorBySlug } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/*
 * generateMetadata and the page both need the post. React's cache dedupes them
 * within a request, so the second call is free rather than a second round trip
 * to Postgres for every page view.
 */
const getRumor = cache(rumorBySlug);

/**
 * How many further posts to show beneath the one being read.
 *
 * These are full cards, not links — headline, summary, faces and badges each —
 * so four of them ran longer than the article itself and buried the end of it.
 * Three is enough to offer a way onward without the page becoming a second
 * feed.
 */
const RELATED_LIMIT = 3;

export async function generateMetadata({
  params,
}: PageProps<"/rumor/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const rumor = await getRumor(slug);
  if (!rumor) return {};

  /*
   * Every post inherited the site-wide title, so a search result, a browser
   * tab and a shared link all read "NBA Rumors — Trades, Signings & Player
   * Movement" no matter which story it was. The headline is the one thing that
   * identifies it.
   */
  // Most bodies fit; the rest break on a word rather than mid-name.
  const description =
    rumor.body.length <= 200
      ? rumor.body
      : `${rumor.body.slice(0, 200).replace(/\s+\S*$/, "")}…`;

  return {
    title: rumor.headline,
    description,
    alternates: { canonical: `/rumor/${rumor.slug}` },
    openGraph: {
      title: rumor.headline,
      description,
      type: "article",
      publishedTime: rumor.publishedAt.toISOString(),
      url: `${SITE.url}/rumor/${rumor.slug}`,
    },
  };
}

export default async function RumorPage({ params }: PageProps<"/rumor/[slug]">) {
  const { slug } = await params;

  const [row] = await db
    .select({
      id: rumors.id,
      isPublished: rumors.isPublished,
      feedItemId: rumors.feedItemId,
    })
    .from(rumors)
    .where(eq(rumors.slug, slug))
    .limit(1);
  if (!row) notFound();

  /*
   * A post that was merged into another is unpublished, not deleted, and its
   * URL was live until the merge ran. Rather than 404 a link someone may
   * already hold, send them to the post that absorbed it.
   *
   * No extra column is needed to find it: merging copies the duplicate's feed
   * item onto the survivor as a source row, so the feed item leads back to
   * whichever post now carries that report.
   */
  if (!row.isPublished) {
    if (row.feedItemId) {
      const [keeper] = await db
        .select({ slug: rumors.slug })
        .from(rumorSources)
        .innerJoin(rumors, eq(rumors.id, rumorSources.rumorId))
        .where(
          and(
            eq(rumorSources.feedItemId, row.feedItemId),
            eq(rumors.isPublished, true),
          ),
        )
        .limit(1);
      if (keeper) permanentRedirect(`/rumor/${keeper.slug}`);
    }
    notFound();
  }

  /*
   * Fetched by slug, not looked up inside the feed. Picking it out of the top
   * 200 meant a post 404'd once it aged out of that window — roughly 430 of
   * 631 published posts, every one of them still listed in the sitemap.
   */
  const rumor = await getRumor(slug);
  if (!rumor) notFound();

  const feed = await latestRumors(200);
  const related = feed
    .filter(
      (r) =>
        r.id !== rumor.id &&
        (r.players.some((p) => rumor.players.some((q) => q.slug === p.slug)) ||
          r.teams.some((t) => rumor.teams.some((u) => u.slug === t.slug))),
    )
    .slice(0, RELATED_LIMIT);

  /*
   * The rail names the team and player this post is ABOUT.
   *
   * It took teams[0], which is only sorted by role, so a post where every team
   * is merely mentioned fell back to whatever Postgres returned first. "Harden,
   * Green among names left as free agency rolls on" mentions four clubs and
   * involves none, and the rail announced Detroit Pistons — a team named once,
   * in a piece about nobody signing anywhere. A merely-mentioned team is not
   * what a post is about, so nothing is claimed at all.
   *
   * Same for the player: several posts mark more than one subject, and taking
   * the first row picked between them arbitrarily. The biggest name wins.
   */
  const subjectPlayer = [...rumor.players]
    .filter((p) => p.isPrimary)
    .sort((a, b) => b.prominence - a.prominence)[0];

  /*
   * The club the subject plays for, not a club this post names.
   *
   * It used to take the first team whose role was not "mentioned", and the
   * roles sort from-before-to, so the rail reliably announced the team the
   * player was LEAVING. A post about Anthony Davis read Philadelphia 76ers
   * while he played in Washington, and one about LeBron James read Los Angeles
   * Lakers a month after he signed in Philadelphia. That is the wrong question
   * asked consistently rather than an ordering accident: 159 of 679 posts
   * carry both a from and a to team.
   *
   * Falling back to the post's own teams when the subject has no club on
   * record — a draft pick, or a name we have never resolved — and to nothing
   * at all when every team is merely mentioned, which is the case a roundup
   * naming four clubs and involving none used to get wrong.
   */
  const subjectTeam =
    subjectPlayer?.currentTeam ??
    rumor.teams.find((t) => t.role === "to") ??
    rumor.teams.find((t) => t.role !== "mentioned");

  return (
    <WireShell
      teamSlug={subjectTeam?.slug}
      teamLabel={subjectTeam ? `${subjectTeam.city} ${subjectTeam.name}` : undefined}
      teamShort={subjectTeam?.name}
      playerLabel={subjectPlayer?.fullName}
      playerShort={subjectPlayer ? surname(subjectPlayer.fullName) : undefined}
    >
      <div className="border-x border-b border-rule bg-surface">
        <div className="border-b border-rule px-4 py-3 sm:px-5">
          <Link
            href="/"
            className="font-mono text-[11px] tracking-wider text-muted uppercase hover:text-link"
          >
            ← Back to the feed
          </Link>
        </div>

        <WireItem rumor={rumor} />

        {related.length > 0 && (
          <section>
            <h2 className="label border-b border-rule px-4 py-3 text-[11px] text-muted sm:px-5">
              Related updates
            </h2>
            {related.map((r) => (
              <WireItem key={r.id} rumor={r} preview />
            ))}
          </section>
        )}
      </div>
    </WireShell>
  );
}
