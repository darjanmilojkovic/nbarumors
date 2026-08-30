"use client";

import { useEffect } from "react";

/**
 * Undo the scroll iOS performs on itself while its toolbars settle.
 *
 * A link opened from another app on iOS Chrome landed on the site with no
 * masthead. It was never hidden and never covered: the probe had the page at
 * y=0 with the header at top:0 and 114px tall for three seconds, on a screen
 * showing neither.
 *
 * The two viewport heights are what explain it. At load innerHeight is 874 —
 * the whole screen — while documentElement.clientHeight is 684, the part not
 * behind the browser's own bars. Chrome lays the page out into the full 874
 * and draws the top of the document underneath the URL bar, so the masthead is
 * painted where it cannot be seen. When the bars settle it shrinks the
 * viewport to 712 and SCROLLS THE PAGE BY 112 to hold steady whatever you were
 * looking at. 112 is the masthead, and it is now above the fold.
 *
 * Nothing of ours moved the page, so nothing of ours could stop it. It can
 * only be undone afterwards.
 *
 * Two conditions, so a reader is never yanked:
 *
 *   the page was at the top when we started, so we are only ever undoing a
 *   scroll that appeared on its own — a reload that legitimately restores a
 *   position starts non-zero and is left alone
 *
 *   nobody has touched the screen, because after that any scroll is theirs
 *
 * Both must hold, and only for a few seconds after load, after which the
 * listeners come off and this costs nothing for the rest of the visit.
 */

/** Long enough for the bars to settle, short enough to never surprise. */
const SETTLE_WINDOW_MS = 4000;

export function StayAtTop() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    /* Already somewhere on purpose — a restored position, or a hash link. */
    if (window.scrollY > 0) return;

    let touched = false;
    const touch = () => {
      touched = true;
    };
    const gestures = ["touchstart", "wheel", "keydown", "pointerdown"] as const;
    for (const type of gestures) {
      window.addEventListener(type, touch, { passive: true, once: true });
    }

    const correct = () => {
      if (touched) return;
      if (window.scrollY === 0) return;
      window.scrollTo(0, 0);
    };

    vv.addEventListener("resize", correct);

    const stop = window.setTimeout(() => {
      vv.removeEventListener("resize", correct);
    }, SETTLE_WINDOW_MS);

    return () => {
      clearTimeout(stop);
      vv.removeEventListener("resize", correct);
      for (const type of gestures) window.removeEventListener(type, touch);
    };
  }, []);

  return null;
}
