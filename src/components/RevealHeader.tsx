"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A header that scrolls away with the page and comes back when you scroll up.
 *
 * Scrolling down is not animated, tracked or handled at all: the header is an
 * ordinary block and the browser scrolls it off natively. Every previous
 * attempt drove that direction from JavaScript — sticky plus a transform, then
 * an offset following the scroll — and both clung to the top for a moment
 * before catching up, because a scroll event arrives after the browser has
 * already painted, and during a fling the events lag well behind the finger.
 * Nothing computed on the main thread can keep up with a native scroll.
 *
 * JavaScript therefore does one thing: on an upward scroll it lifts the header
 * out of flow and pins it. A spacer takes its place at exactly its own height,
 * so the swap costs no layout and nothing below it moves.
 *
 * Used only on pages with nothing else pinned. Every fault in this component's
 * previous life came from the filter bar sticking to a CSS variable holding
 * this element's height; it publishes nothing now.
 */

/**
 * Scroll restoration happens after effects run and arrives as a downward
 * gesture, so a refresh partway down a page must not be read as the reader
 * moving.
 */
const RESTORE_WINDOW_MS = 700;

/** Below this the elastic bounce and trackpad jitter would flicker it. */
const MOVEMENT_THRESHOLD_PX = 6;

export function RevealHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [height, setHeight] = useState(0);

  /*
   * The shell sits at the same position in the tree on every page, so React
   * reuses this component across a route change rather than remounting it. A
   * pinned header would otherwise travel to the next article.
   */
  const pathname = usePathname();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const desktop = window.matchMedia("(min-width: 640px)");
    const mountedAt = performance.now();
    let last = window.scrollY;
    let isPinned = false;

    const set = (next: boolean) => {
      if (next === isPinned) return;
      /*
       * Never lift the header out of flow without knowing what it leaves
       * behind. Read from the element rather than the state, which is captured
       * from the render this effect ran in and would be stale. Unpinning is
       * always allowed: putting the header back cannot orphan a spacer.
       */
      if (next && el.offsetHeight === 0) return;
      isPinned = next;
      setPinned(next);
    };

    const onScroll = () => {
      if (desktop.matches) return set(false);
      const y = window.scrollY;

      if (performance.now() - mountedAt < RESTORE_WINDOW_MS) {
        last = y;
        return set(false);
      }

      /*
       * Above its own height the header is still partly on screen where it
       * belongs, and pinning there would jump it to fully visible. It is also
       * the point below which taking it out of flow would move what the reader
       * is looking at, since its slot is no longer entirely above the fold.
       */
      const natural = el.offsetHeight || height;
      if (y <= natural) {
        last = y;
        return set(false);
      }

      if (y < last - MOVEMENT_THRESHOLD_PX) set(true);
      else if (y > last + MOVEMENT_THRESHOLD_PX) set(false);

      if (Math.abs(y - last) > MOVEMENT_THRESHOLD_PX) last = y;
    };

    /*
     * The back/forward cache restores a page without remounting anything or
     * changing the pathname, so the effect never re-runs.
     */
    const onPageShow = () => {
      last = window.scrollY;
      set(false);
    };

    /*
     * Measured continuously while in flow, not once on mount.
     *
     * A single reading is taken before the webfonts arrive, and the masthead
     * is 114px in Noto and a different height in whatever fallback is standing
     * in for it. The spacer is then built from that stale number, so when the
     * header lifts out of flow the content below moves by the difference —
     * and if the reading was 0, no spacer renders at all and it moves by the
     * whole masthead.
     *
     * It only showed on iOS Chrome, which is not a rendering difference: every
     * iOS browser is WKWebView, so Chrome and Safari share an engine there.
     * They do not share a font cache. Safari had the fonts from earlier visits
     * and measured the final height; Chrome was fetching them and measured the
     * fallback. Desktop Chrome's device emulation is Blink and never
     * reproduced it.
     *
     * Skipped while pinned, when the element is out of flow and its height is
     * no longer the space it needs to reserve.
     */
    const measure = () => {
      if (!isPinned) setHeight(el.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    desktop.addEventListener("change", onScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onPageShow);
      desktop.removeEventListener("change", onScroll);
    };
    // height is measured here, not an input to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {/*
       * Holds the header's place while it is pinned, so lifting it out of flow
       * costs no layout and the article does not shift under the reader.
       */}
      {pinned && height > 0 ? <div style={{ height }} aria-hidden /> : null}
      <div
        ref={ref}
        className={
          pinned
            ? "fixed inset-x-0 top-0 z-30 animate-[reveal_200ms_ease-out] sm:static sm:animate-none"
            : undefined
        }
      >
        {children}
      </div>
    </>
  );
}
