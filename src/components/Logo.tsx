/**
 * The mark: a ball whose right-hand seams break into broadcast waves — a
 * rumor leaving the building. Stroked rather than filled so it stays crisp at
 * 28px, and the waves use currentColor so the whole lockup reacts to hover.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* ball */}
      <circle
        cx="17"
        cy="20"
        r="12.5"
        className="stroke-accent"
        strokeWidth="2.4"
      />
      {/* vertical seam */}
      <path d="M17 7.5v25" className="stroke-accent" strokeWidth="2" />
      {/* horizontal seam, stopping short on the right where the waves take over */}
      <path d="M4.6 20h16.6" className="stroke-accent" strokeWidth="2" />
      {/* curved side seams */}
      <path
        d="M8.4 10.6c3.4 5.6 3.4 13.2 0 18.8"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M25.6 10.6c1.5 2.5 2.3 5.3 2.4 8.1"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* signal */}
      <path
        d="M27.5 24.4a6.4 6.4 0 0 0 4.3-4.6"
        strokeWidth="2"
        strokeLinecap="round"
        stroke="currentColor"
        opacity="0.85"
      />
      <path
        d="M31.4 27.9a11 11 0 0 0 5.6-7.7"
        strokeWidth="2"
        strokeLinecap="round"
        stroke="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}
