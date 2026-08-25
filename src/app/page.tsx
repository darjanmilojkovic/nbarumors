import Link from "next/link";
import { WireShell } from "@/components/WireShell";
import { WireItem } from "@/components/WireItem";
import { latestRumors, type FeedRumor } from "@/lib/queries";

export const revalidate = 300;

const TABS = [
  { key: "live", label: "Live" },
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

/**
 * "Top" means biggest story, not best-sourced one.
 *
 * It used to sort on sourceCount then confidence, but 186 of 200 posts carry
 * exactly one outlet, so the tab was really "the 14 corroborated posts, then
 * everything else by a confidence score that clusters at 0.9-1.0". That put a
 * Dillon Brooks extension above LeBron-to-Philadelphia, and a Lonnie Walker
 * signing — prominence 0 — at number two.
 *
 * The weights, in order of how much work they do:
 * - prominence (0-100) is the base: who the story is about.
 * - hotMentions x3 is the strongest signal we have that something is THE
 *   story of the week. 13 separate posts about Klay Thompson in seven days
 *   is the site telling us where the attention is, and it was being ignored.
 * - corroboration is a bonus, not the sort key. One extra outlet is worth 12
 *   points, roughly a tier of prominence, so a well-sourced mid-tier story
 *   can still beat a thin star rumor without steamrolling the ranking.
 * - confidence breaks ties; its range is too narrow to do more.
 *
 * Recency is deliberately absent — the Live tab is the chronological view,
 * and duplicating it here would leave no tab that surfaces the big stories.
 */
const topScore = (r: FeedRumor) =>
  r.maxProminence +
  r.hotMentions * 3 +
  (r.sourceCount - 1) * 12 +
  r.confidence * 10;

const href = (tab: string, cat: string) => {
  const p = new URLSearchParams();
  if (tab !== "live") p.set("tab", tab);
  if (cat) p.set("cat", cat);
  const q = p.toString();
  return q ? `/?${q}` : "/";
};

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { tab: rawTab, cat: rawCat } = await searchParams;
  const tab = typeof rawTab === "string" ? rawTab : "live";
  const cat = typeof rawCat === "string" ? rawCat : "";

  // Pull wide, then filter — the dataset is small enough that a second set of
  // query paths would cost more in complexity than it saves in rows.
  const all = await latestRumors(200);

  let rumors = cat ? all.filter((r) => r.type === cat) : all;
  if (tab === "confirmed") {
    rumors = rumors.filter(
      (r) => r.status === "confirmed" || r.status === "completed",
    );
  } else if (tab === "top") {
    rumors = [...rumors].sort((a, b) => topScore(b) - topScore(a));
  }
  rumors = rumors.slice(0, 40);

  return (
    <WireShell>
      <h1 className="sr-only">Latest NBA trade rumors and signings</h1>

      <div className="border-x border-rule bg-surface sm:mx-0">
        {/* tabs */}
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

        <p className="px-4 py-8 text-center font-mono text-[11px] tracking-widest text-muted uppercase">
          — End of the feed —
        </p>
      </div>
    </WireShell>
  );
}
