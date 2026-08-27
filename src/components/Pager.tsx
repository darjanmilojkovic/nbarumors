import Link from "next/link";

/**
 * Previous/next controls with a position readout.
 *
 * Lifted out of the front page when team and player pages needed it too. Those
 * two stopped dead at 30 posts with nothing to say there was more — the
 * position readout matters as much as the arrows, because "Page 1 of 4 · 37
 * posts" is what tells a reader the list did not simply end.
 *
 * `hrefFor` rather than a route prop: the front page carries its tab and
 * category through the query string, a team page carries nothing but the page
 * number, and the caller is the only one that knows which.
 */
export function Pager({
  page,
  pageCount,
  total,
  hrefFor,
  noun = "posts",
}: {
  page: number;
  pageCount: number;
  total: number;
  hrefFor: (page: number) => string;
  noun?: string;
}) {
  const button =
    "rounded-sm border border-rule px-3 py-2 font-mono text-[11px] tracking-widest text-body uppercase hover:border-link hover:text-link";

  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-8 sm:px-5">
      {/* A spacer keeps the readout centred when an arrow is missing. */}
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={button}>
          ← Newer
        </Link>
      ) : (
        <span />
      )}

      <span className="font-mono text-[11px] tracking-widest text-muted uppercase">
        {total === 0 ? "Nothing here" : `Page ${page} of ${pageCount} · ${total} ${noun}`}
      </span>

      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" className={button}>
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
