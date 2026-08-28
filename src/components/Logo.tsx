/**
 * Orbiter: an orange ball that is also a satellite.
 *
 * Four motions at four speeds, so it never reads as one rigid object turning —
 * the seams spin inside the sphere at 9s, the wings and antenna tumble at 24s,
 * a satellite runs the orbit at 7s, and the beacon blinks at 2.2s. The
 * specular highlight is drawn OUTSIDE the spinning group and stays put, which
 * is what sells a sphere rather than a spinning disc: the ball turns, the light
 * source does not.
 *
 * CSS animation rather than SMIL, entirely so that prefers-reduced-motion can
 * switch it off — SMIL ignores that query, and a logo that spins forever at
 * someone who has asked the machine to stop moving is not a logo, it is a
 * nuisance.
 *
 * The viewBox is centred on the origin so every rotation shares one transform
 * origin and the mark can be scaled anywhere without recomputing centres.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="-40 -40 80 80"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <style>{`
        .lg-rot { transform-box: view-box; transform-origin: 40px 40px; }
        .lg-seams  { animation: lg-spin 9s linear infinite; }
        .lg-body   { animation: lg-spin 24s linear infinite; }
        .lg-sat {
          offset-path: path('M31,0 A31,12.5 0 1,1 -31,0 A31,12.5 0 1,1 31,0');
          animation: lg-travel 7s linear infinite;
        }
        .lg-beacon { animation: lg-blink 2.2s ease-in-out infinite; }
        @keyframes lg-spin   { to { transform: rotate(360deg); } }
        @keyframes lg-travel { to { offset-distance: 100%; } }
        @keyframes lg-blink  { 0%, 100% { opacity: 1 } 50% { opacity: .15 } }
        @media (prefers-reduced-motion: reduce) {
          .lg-seams, .lg-body, .lg-sat, .lg-beacon { animation: none; }
        }
      `}</style>

      <defs>
        <radialGradient id="lg-sphere" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#ffc178" />
          <stop offset="38%" stopColor="#f08a2c" />
          <stop offset="78%" stopColor="#d2691a" />
          <stop offset="100%" stopColor="#8f3f0c" />
        </radialGradient>
        <radialGradient id="lg-glow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#e07a2f" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#e07a2f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lg-panel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6ba6e0" />
          <stop offset="50%" stopColor="#2f6098" />
          <stop offset="100%" stopColor="#16324f" />
        </linearGradient>
        <radialGradient id="lg-spec" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3e0" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fff3e0" stopOpacity="0" />
        </radialGradient>
        <clipPath id="lg-ball">
          <circle cx="0" cy="0" r="20" />
        </clipPath>
      </defs>

      {/* orbit, tilted, with a satellite running it */}
      <g transform="rotate(-24)">
        <ellipse rx="31" ry="12.5" stroke="#5e9ad8" strokeWidth="1.6" opacity="0.5" />
        <circle className="lg-sat" r="2.4" fill="#e3b23c" />
      </g>

      <circle r="30" fill="url(#lg-glow)" />

      {/* wings and antenna, tumbling together */}
      <g className="lg-rot lg-body">
        <path d="M-20 0h-6M20 0h6" stroke="#9a9a9a" strokeWidth="1.8" />
        <rect x="-40" y="-7" width="14" height="14" rx="1.4" fill="url(#lg-panel)" />
        <rect x="26" y="-7" width="14" height="14" rx="1.4" fill="url(#lg-panel)" />
        <g stroke="#0f2036" strokeWidth="0.7" opacity="0.85">
          <path d="M-35.3-7v14M-30.7-7v14M-40-2.3h14M-40 2.3h14" />
          <path d="M30.7-7v14M35.3-7v14M26-2.3h14M26 2.3h14" />
        </g>
        <path d="M0-20v-7" stroke="#9a9a9a" strokeWidth="1.6" />
        <circle cy="-28.5" r="2.6" stroke="#5e9ad8" strokeWidth="1.6" />
        <circle className="lg-beacon" cy="-28.5" r="1" fill="#e3b23c" />
      </g>

      {/* the body */}
      <circle r="20" fill="url(#lg-sphere)" />
      <g clipPath="url(#lg-ball)">
        <g
          className="lg-rot lg-seams"
          stroke="#7d3608"
          strokeWidth="1.9"
          opacity="0.9"
        >
          <path d="M0-21v42M-21 0h42" />
          <path d="M-11.5-17.5c5.5 9.5 5.5 25.5 0 35M11.5-17.5c-5.5 9.5-5.5 25.5 0 35" />
        </g>
      </g>
      <circle r="20" stroke="#5a2604" strokeWidth="0.9" opacity="0.55" />
      {/* fixed highlight: the ball turns, the light does not */}
      <ellipse
        cx="-6.5"
        cy="-7"
        rx="7.5"
        ry="5.5"
        fill="url(#lg-spec)"
        transform="rotate(-32 -6.5 -7)"
      />
    </svg>
  );
}
