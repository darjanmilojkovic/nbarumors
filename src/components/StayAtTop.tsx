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

/**
 * Long enough for the bars to settle, short enough to never surprise.
 *
 * Was 4000, which closed before the scroll arrived on at least one run: the
 * log read "armed at y=0" then "window closed" with no correction between,
 * on a load that still lost its masthead.
 */
const SETTLE_WINDOW_MS = 12000;

/**
 * How far down the reader can be and still be treated as "at the top".
 *
 * The masthead is 114px. Inside that, the page is still showing its own head
 * and snapping to 0 is what the reader already meant; past it they have gone
 * somewhere deliberately and must be left alone. This is what replaces the
 * touch guard, which was not merely useless but backwards — Chrome collapses
 * its toolbar ON the first touch, so the correction disqualified itself at
 * precisely the moment it was needed.
 */
const NEAR_TOP_PX = 130;

/**
 * What this component decided, for ScrollProbe to render.
 *
 * The first version of this fix deployed and changed nothing on the device,
 * and there is no way to tell from the outside whether it declined to act,
 * acted and was overruled, or never ran. Guessing at that is what has already
 * cost four wrong fixes.
 */
declare global {
  interface Window {
    __stayAtTop?: string[];
  }
}

const note = (s: string) => {
  const log = (window.__stayAtTop ??= []);
  if (log.length < 20) log.push(s);
};

export function StayAtTop() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return note("no visualViewport");
    /* Already somewhere on purpose — a restored position, or a hash link. */
    if (window.scrollY > 0) return note(`start y=${Math.round(window.scrollY)}, standing down`);

    note("armed at y=0");

    const correct = (why: string) => {
      const y = Math.round(window.scrollY);
      if (y === 0) return;
      /* Gone somewhere on purpose. Leave the reader where they are. */
      if (y > NEAR_TOP_PX) return note(`${why} y=${y} SKIP reader is reading`);
      window.scrollTo(0, 0);
      note(`${why} y=${y} -> ${Math.round(window.scrollY)}`);
    };

    /*
     * Both signals, not just the resize.
     *
     * The resize fires when the bars settle, but the scroll it causes may
     * arrive separately or more than once, and correcting only on the resize
     * loses that race. Re-asserting on scroll costs nothing: the guard above
     * returns immediately once the page is at the top, so this is inert except
     * in the moments it exists for.
     */
    const onResize = () => correct("vvresize");
    const onScroll = () => correct("scroll");
    vv.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });

    const stop = window.setTimeout(() => {
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      note("window closed");
    }, SETTLE_WINDOW_MS);

    return () => {
      clearTimeout(stop);
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
