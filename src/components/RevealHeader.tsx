"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A header that scrolls away like ordinary content and slides back when you
 * scroll up.
 *
 * The element is sticky, so it never leaves a hole in the layout, but a sticky
 * element pins from the very first pixel — which made it cling to the top for
 * its own height before finally retracting. Reading down, that reads as the
 * header being stubbornly attached and then giving up.
 *
 * So the offset follows the scroll rather than being an on/off flag. Going
 * down it is translated up by exactly how far the page has moved, which is
 * indistinguishable from the header scrolling away, and it stops once it is
 * fully out of sight. Going up it returns to zero and the transition carries
 * it back in.
 *
 * That also means no separate rule about not hiding before it is pinned: the
 * offset can never exceed the distance actually scrolled, so the element is
 * never lifted out of space that is still on screen. The band of background
 * this used to leave above "Back to the feed" is unreachable by construction.
 *
 * Used only on pages with nothing else pinned. Every fault in this component's
 * previous life came from the filter bar sticking to a CSS variable holding
 * its height; it publishes nothing now.
 */

/**
 * How long after mount a scroll is treated as the browser placing the page
 * rather than the reader moving through it. Scroll position is restored AFTER
 * effects run, and restored by scrolling — without this, refreshing partway
 * down an article retracted the header before the reader touched anything.
 */
const RESTORE_WINDOW_MS = 700;

/** Below this the elastic bounce and trackpad jitter would twitch it. */
const MOVEMENT_THRESHOLD_PX = 2;

export function RevealHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * Every page renders the shell at the same position in the tree, so React
   * reuses this component across a route change rather than remounting it. Any
   * offset left behind would travel to the next article.
   */
  const pathname = usePathname();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const desktop = window.matchMedia("(min-width: 640px)");
    const mountedAt = performance.now();
    let last = window.scrollY;
    let offset = 0;

    /*
     * Written straight to the node rather than held in state. This runs on
     * every scroll event, and a React render per frame is both wasted work and
     * a source of stutter in the one place it would be most visible.
     */
    const draw = (next: number, animated: boolean) => {
      if (next === offset) return;
      offset = next;
      el.style.transitionProperty = animated ? "transform" : "none";
      el.style.transform = `translateY(${-offset}px)`;
    };

    const onScroll = () => {
      if (desktop.matches) return draw(0, false);
      const y = window.scrollY;

      if (performance.now() - mountedAt < RESTORE_WINDOW_MS) {
        last = y;
        return draw(0, false);
      }

      const height = el.offsetHeight;
      if (y <= 0) {
        last = y;
        return draw(0, false);
      }

      if (y > last + MOVEMENT_THRESHOLD_PX) {
        /*
         * Never further than the page has actually scrolled, so the header
         * tracks the content rather than outrunning it, and never further than
         * its own height, which is where it is fully out of sight.
         */
        draw(Math.min(height, y), false);
        last = y;
      } else if (y < last - MOVEMENT_THRESHOLD_PX) {
        draw(0, true);
        last = y;
      }
    };

    /*
     * The back/forward cache restores a page without remounting anything or
     * changing the pathname, so the effect never re-runs and the reader would
     * return to whatever offset they left.
     */
    const onPageShow = () => {
      last = window.scrollY;
      draw(0, false);
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
      className="sticky top-0 z-30 duration-200 ease-out motion-reduce:transition-none sm:static sm:transform-none"
    >
      {children}
    </div>
  );
}
