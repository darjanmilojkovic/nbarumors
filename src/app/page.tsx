import Link from "next/link";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { latestRumors } from "@/lib/queries";

export const revalidate = 300;

const SORTS = [
  { key: "live", label: "Latest" },
  { key: "top", label: "Credible" },
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
    rumors = [...rumors].sort(
      (a, b) => b.sourceCount - a.sourceCount || b.confidence - a.confidence,
    );
  }
  rumors = rumors.slice(0, 40);

  return (
    <WireShell activeBeat={cat || undefined}>
      <h1 className="sr-only">Latest NBA trade rumors and signings</h1>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2.5 pt-5 pb-4">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {CHIPS.map((c) => (
            <Link
              key={c.key || "all"}
              href={href(tab, c.key)}
              aria-pressed={cat === c.key}
              className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] uppercase ${
                cat === c.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-2 text-muted hover:border-ink-2 hover:text-ink"
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex gap-0.5 rounded-sm border border-line-2 p-0.5">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={href(s.key, cat)}
              aria-selected={tab === s.key}
              className={`rounded-[1px] px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.1em] uppercase ${
                tab === s.key ? "bg-ink text-ground" : "text-muted hover:text-ink"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {rumors.length === 0 ? (
        <p className="py-14 text-center text-muted">
          Nothing in the rumor mill matches that filter.
        </p>
      ) : (
        rumors.map((r) => <WireItem key={r.id} rumor={r} />)
      )}

      <p className="border-t border-line pt-7 pb-2 text-center font-mono text-[10.5px] tracking-[0.16em] text-muted uppercase">
        — End of the rumor mill —
      </p>
    </WireShell>
  );
}
