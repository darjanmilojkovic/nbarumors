import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pager } from "@/components/Pager";
import { WireShell } from "@/components/WireShell";
import { WireItem } from "@/components/WireItem";
import { feedPage } from "@/lib/queries";
import { SITE } from "@/lib/site";
import { CHIP_LABEL, CHIP_ORDER } from "@/lib/beats";

export const revalidate = 300;

/*
 * Four tabs, four different questions — the labels were three variations on
 * "the important ones" before:
 *
 *   Trending    what matters now, prominence decayed by age
 *   Latest      the wire as it came in, newest first, nothing weighted
 *   Top Rated   the biggest stories, with recency deliberately absent
 *   Confirmed   the ones that actually happened — a filter, not an ordering
 *
 * Trending leads and is the default, so the highlighted tab is the first one.
 * Keys are frozen: "live", "top" and "confirmed" appear in every /?tab= link
 * ever shared, so only the labels move.
 *
 * Confirmed stays Confirmed. "Done Deals" was considered and rejected: it is
 * the badge these posts already carry and the heading the right rail already
 * uses for them, so all three would have agreed — but that rail card sits
 * beside this column on the feed, and a tab echoing it a few hundred pixels
 * away reads as redundancy rather than consistency.
 *
 * Trending and Latest were briefly the same thing. The left rail links to
 * "/", which is Trending, so making the rail chronological quietly took the
 * ranking away from the default landing page — the one most people ever see.
 *
 * On Top Rated, corroboration does most of the separating: it is worth up to
 * 36 points, and the prominence floors put around 35 players at exactly 100,
 * so prominence saturates at the top and the outlet count decides. That is a
 * proxy for importance rather than a contradiction of it — seven of the first
 * ten are the biggest stories of the period, the other three well-covered
 * trivia. If those grate, the corroboration multiplier is the lever, not
 * prominence. See TOP in lib/queries.
 */
const TABS = [
  { key: "live", label: "Trending" },
  { key: "latest", label: "Latest" },
  { key: "top", label: "Top Rated" },
  { key: "confirmed", label: "Confirmed" },
] as const;

/*
 * Built from the shared beat definitions, so the chips and the rail cannot
 * disagree about what a category is or what it is called.
 */
const CHIPS = [
  { key: "", label: "All" },
  ...CHIP_ORDER.map((key) => ({ key, label: CHIP_LABEL[key] ?? key })),
];

/**
 * Twenty, down from forty.
 *
 * Forty made sense when a card was a headline and two sentences. Cards now
 * show an opening paragraph and a way in, which is a page you choose from
 * rather than scroll past — and half as many of them is the other half of that
 * change. Team and player pages sit at ten for the same reason.
 */
const PER_PAGE = 20;

/**
 * Page is deliberately dropped when the tab or the category changes: landing
 * on page 7 of a filter you just picked would be a dead end.
 */
const href = (tab: string, cat: string, page = 1) => {
  const p = new URLSearchParams();
  if (tab !== "live") p.set("tab", tab);
  if (cat) p.set("cat", cat);
  if (page > 1) p.set("page", String(page));
  const q = p.toString();
  return q ? `/?${q}` : "/";
};

/*
 * The tabs and categories are the same wire re-ordered and filtered, so they
 * all point their canonical at "/" rather than competing with it. Pagination
 * is different — page 7 holds posts page 1 does not — so it gets a canonical
 * of its own, and a title that says where you are.
 */
export async function generateMetadata({
  searchParams,
}: PageProps<"/">): Promise<Metadata> {
  const { tab: rawTab, cat: rawCat, page: rawPage } = await searchParams;
  const tab = typeof rawTab === "string" ? rawTab : "live";
  const cat = typeof rawCat === "string" ? rawCat : "";
  const page = Math.max(1, Number(rawPage) || 1);

  if (page === 1) return { alternates: { canonical: "/" } };

  const label = CHIPS.find((c) => c.key === cat)?.label;
  const scope = label && cat ? `${label} · ` : "";
  return {
    title: {
      absolute: `${scope}${
        TABS.find((t) => t.key === tab)?.label ?? "Trending"
      } — page ${page} — ${SITE.name}`,
    },
    alternates: { canonical: href(tab, cat, page) },
  };
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const {
    tab: rawTab,
    cat: rawCat,
    page: rawPage,
  } = await searchParams;
  const tab = typeof rawTab === "string" ? rawTab : "live";
  const cat = typeof rawCat === "string" ? rawCat : "";

  const page = Math.max(1, Number(rawPage) || 1);
  const { rumors, total, pageCount } = await feedPage({
    tab,
    cat,
    page,
    perPage: PER_PAGE,
  });

  /*
   * A page past the last one does not exist; it is not an empty page. Serving
   * 200 with no posts told crawlers that /?page=99 and every other number was
   * a real but thin page, and gave a reader who mistyped a URL a blank column
   * with no hint of what went wrong.
   */
  if (page > pageCount) notFound();

  /*
   * The filter bar below is this page's pinned element, so the masthead
   * scrolls away rather than competing with it. One pinned element per page.
   */
  return (
    <WireShell pinHeader={false}>
      <h1 className="sr-only">Latest NBA trade rumors and signings</h1>

      <div className="border-x border-b border-rule bg-surface sm:mx-0">
        {/* tabs */}
        {/*
         * Pinned to the top of the viewport, full stop. It used to stick to a
         * CSS variable carrying the masthead's current height, which meant
         * this bar jumped 110px in one frame whenever the masthead decided to
         * hide itself. The masthead now scrolls away like an ordinary header,
         * so this offset is a constant.
         */}
        <div className="sticky top-0 z-10 border-b border-rule bg-surface/95 backdrop-blur">
          <div className="flex">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={href(t.key, cat)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`flex-1 border-b-2 py-3 text-center font-mono text-[11px] tracking-wider uppercase ${
                  tab === t.key
                    ? "border-link text-link"
                    : "border-transparent text-muted hover:bg-surface-2 hover:text-white"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {/* category chips — horizontally scrollable on mobile */}
          <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5 sm:justify-center">
            {CHIPS.map((c) => (
              <Link
                key={c.key || "all"}
                href={href(tab, c.key)}
                aria-pressed={cat === c.key}
                className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wider uppercase ${
                  cat === c.key
                    ? "border-link bg-link/10 text-link"
                    : "border-rule text-muted hover:border-body hover:text-white"
                }`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>

        {rumors.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            No rumors match that filter.
          </p>
        ) : (
          rumors.map((r) => <WireItem key={r.id} rumor={r} preview />)
        )}

        {/*
         * This used to read "End of the feed" under the first 40 posts while
         * 582 others sat in the database with URLs nothing linked to. It now
         * says where you are, and only claims the end when it is the end.
         */}
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          hrefFor={(p) => href(tab, cat, p)}
        />
      </div>
    </WireShell>
  );
}
