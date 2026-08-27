"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A header that retracts as you read down and comes back when you scroll up.
 *
 * This is the pattern that caused four bugs in its previous life, and it is
 * safe here for one reason: nothing else on the page is pinned. The faults all
 * came from the filter bar sticking to a CSS variable holding this element's
 * current height, so the two had to agree frame by frame and did not. It now
 * publishes nothing, and is used only on pages the filter bar does not appear
 * on.
 *
 * The remaining trap is geometric rather than architectural, and is handled
 * below: a sticky element cannot be hidden before it is pinned.
 */

/**
 * How long after mount a scroll is treated as the browser placing the page
 * rather than the reader moving through it.
 *
 * Scroll position is restored AFTER effects run, and it is restored by
 * scrolling — which arrives here as a downward gesture. Without this,
 * refreshing halfway down an article hid the header before the reader had
 * touched anything.
 */
const RESTORE_WINDOW_MS = 700;

/** Below this the elastic bounce and trackpad jitter would flicker it. */
const MOVEMENT_THRESHOLD_PX = 6;

export function RevealHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  /*
   * Every page renders the shell at the same position in the tree, so React
   * reuses this component across a route change rather than remounting it, and
   * the hidden state would travel with it — leaving a new article opening with
   * its header already retracted. Re-running on pathname resets that.
   */
  const pathname = usePathname();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const mountedAt = performance.now();
    let last = window.scrollY;

    const onScroll = () => {
      if (desktop.matches) return setHidden(false);
      const y = window.scrollY;

      if (performance.now() - mountedAt < RESTORE_WINDOW_MS) {
        last = y;
        return setHidden(false);
      }

      /*
       * Nothing hides until the header is actually pinned.
       *
       * A sticky element only pins once you have scrolled past its own height.
       * Before that it is an ordinary block at the top of the document, and
       * sliding it up empties the space it occupies without letting anything
       * move in — the reader gets a band of background as tall as whatever is
       * left of its box. Past its own height that space is off screen and the
       * article is already scrolling underneath it, so hiding costs nothing.
       *
       * This also covers iOS rubber-banding driving scrollY negative.
       */
      const height = ref.current?.offsetHeight ?? 0;
      if (y < height) {
        last = y;
        return setHidden(false);
      }

      if (Math.abs(y - last) < MOVEMENT_THRESHOLD_PX) return;
      const goingUp = y < last;
      last = y;
      setHidden(!goingUp);
    };

    /*
     * The back/forward cache restores a page without remounting anything or
     * changing the pathname, so the effect never re-runs and the reader
     * returns to whatever state they left.
     */
    const onPageShow = () => {
      last = window.scrollY;
      setHidden(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    desktop.addEventListener("change", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onPageShow);
      desktop.removeEventListener("change", onScroll);
    };
  }, [pathname]);

  return (
    <div
      ref={ref}
      className={`sticky top-0 z-30 transition-transform duration-200 motion-reduce:transition-none sm:static sm:translate-y-0 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {children}
    </div>
  );
}
