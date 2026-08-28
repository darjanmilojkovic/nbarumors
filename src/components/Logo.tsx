import Image from "next/image";

/**
 * The mark: a basketball trailing flame, with the broadcast waves that the
 * stroked mark before it carried — a rumor leaving the building.
 *
 * That earlier mark was drawn in currentColor, which is why the lockup no
 * longer turns link-blue on hover: artwork with its own palette cannot inherit
 * one. SiteHeader substitutes a small lift so the lockup still answers the
 * cursor.
 *
 * Served at 168px — three times the largest size it renders at, so it stays
 * sharp on a 3x display — and as WebP, which takes the same frame from 58.5KB
 * to 21.9KB. It sits in the masthead of every page, so the difference is worth
 * having.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/logo-mark.webp"
      alt=""
      width={168}
      height={168}
      className={`object-contain ${className}`}
      /* In the masthead of every page, so it should never arrive late. */
      priority
      unoptimized
      aria-hidden="true"
    />
  );
}
