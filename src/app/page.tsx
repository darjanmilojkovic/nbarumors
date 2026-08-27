import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pager } from "@/components/Pager";
import { WireShell } from "@/components/WireShell";
import { WireItem } from "@/components/WireItem";
import { feedPage } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/*
 * Four views, three of them genuinely different questions:
 *
 *   live       shown as Trending: what matters right now, prominence decayed by age
 *   latest     the wire as it came in, newest first, nothing weighted
 *   top        the biggest stories, with recency deliberately absent
 *   confirmed  a filter rather than an ordering
 *
 * Trending and Latest were briefly the same thing. The left rail links to
 * "/", which is Trending, so making the rail chronological quietly took the
 * ranking away from the default landing page — the one most people ever see.
 */
const TABS = [
  // The key stays "live": it is in every /?tab= link already shared.
  { key: "live", label: "Trending" },
  { key: "latest", label: "Latest" },
  { key: "top", label: "Top" },
  { key: "confirmed", label: "Confirmed" },
] as const;

const CHIPS = [
  { key: "", label: "All" },
  { key: "trade", label: "Trades" },
  { key: "signing", label: "Signings" },
  { key: "free_agency", label: "Free agency" },
  { key: "extension", label: "Extensions" },
  { key: "buyout", label: "Buyouts" },
  { key: "waiver", label: "Waivers" },
  { key: "draft", label: "Draft" },
] as const;

const PER_PAGE = 40;

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

      <div className="border-x border-rule bg-surface sm:mx-0">
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
          rumors.map((r) => <WireItem key={r.id} rumor={r} />)
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
