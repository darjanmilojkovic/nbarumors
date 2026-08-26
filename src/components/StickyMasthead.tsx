"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * On a phone the masthead hides as you scroll down and comes back the moment
 * you scroll up, so the logo and the way home are always one gesture away
 * without permanently spending 110px of a 812px screen.
 *
 * It publishes its own height as --masthead-offset while visible, and the
 * filter bar sticks to that rather than to the top of the viewport. Both
 * elements pinned at top:0 would have meant the masthead sliding over the
 * tabs and hiding them, which looks like a bug rather than a reveal.
 *
 * Above sm the masthead is static again, exactly as before: at that width it
 * scrolls away and the filter bar takes the top on its own.
 */

/**
 * How long after mount a scroll is assumed to be the browser placing the page
 * rather than the reader moving through it. Generous on purpose: being wrong
 * this way costs a masthead that stays up slightly too long, and being wrong
 * the other way costs the masthead entirely.
 */
const RESTORE_WINDOW_MS = 700;

/**
 * How far down the page the masthead is held in place regardless of gesture.
 *
 * About one screen on a phone. Below this the reader is still at the top of
 * the feed, where the logo and the way home belong on screen; past it they are
 * reading, and 110px of a 812px screen is worth reclaiming.
 */
const HOLD_UNTIL_PX = 600;

export function StickyMasthead({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  /*
   * Every page renders WireShell at the same position in the tree, so React
   * reuses this component across a route change rather than remounting it —
   * and `shown` carried over with it. Scrolling down the feed hid the
   * masthead, tapping through to an article kept it hidden, and because a
   * translated sticky element still occupies its space in normal flow, the
   * article opened with a masthead-sized hole above it. Reported on iOS
   * Safari, but nothing about it was Safari-specific.
   *
   * Re-running on pathname puts it back for each new page.
   */
  const pathname = usePathname();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    let last = window.scrollY;

    /*
     * Scroll position is restored AFTER this effect runs, and the browser
     * restores it by scrolling. That arrived here as an ordinary downward
     * gesture, so refreshing halfway down the feed — or halfway down an
     * article — hid the masthead before the reader had touched anything, and
     * it stayed hidden until they scrolled back up. Back-navigation restores
     * the same way.
     *
     * Anything in the first moments after mount is therefore treated as the
     * page being placed, not read: track the position, stay visible.
     */
    const mountedAt = performance.now();

    const apply = (visible: boolean) => {
      setShown(visible);
      const height = ref.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty(
        "--masthead-offset",
        !desktop.matches && visible ? `${height}px` : "0px",
      );
    };

    const onScroll = () => {
      if (desktop.matches) return apply(true);
      const y = window.scrollY;

      if (performance.now() - mountedAt < RESTORE_WINDOW_MS) {
        last = y;
        return apply(true);
      }

      /*
       * Near the top it stays, whatever the gesture.
       *
       * Eight pixels was too literal a reading of "at the top": the masthead
       * vanished on the first flick, while the filter tabs below it stayed
       * pinned, so the two halves of one header behaved differently before the
       * reader had gone anywhere. Holding it for roughly a screen means the
       * top of the feed is read with the masthead in place, and it only starts
       * retracting once you are plainly down in the wire.
       *
       * This also covers what the old check was for: hiding it at the very top
       * leaves a hole, because there is nothing above the masthead for it to
       * slide behind, and iOS rubber-banding drives scrollY negative.
       */
      if (y < HOLD_UNTIL_PX) {
        last = y;
        return apply(true);
      }

      /*
       * A small threshold, or the header flickers on the elastic bounce at the
       * top of the page and on the one-pixel jitter of a trackpad.
       */
      if (Math.abs(y - last) < 6) return;
      const goingUp = y < last;
      last = y;
      apply(goingUp);
    };

    /*
     * Coming back from the back/forward cache does not remount the component
     * or change the pathname, so the effect above never re-runs and whatever
     * state the masthead was left in is what the reader returns to.
     */
    const onPageShow = () => {
      last = window.scrollY;
      apply(true);
    };

    apply(true);
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
        shown ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      {children}
    </div>
  );
}
