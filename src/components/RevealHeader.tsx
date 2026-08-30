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
/**
 * Confirmed by turning it off: this component was hiding the masthead.
 *
 * Rumor pages opened on an iPhone in Chrome with no masthead at all — not
 * scrolled past it, since scrolling up did not bring it back. Turning the
 * retract off made them open correctly, which named the culprit after two
 * wrong guesses at the mechanism.
 *
 * The conditions were the tell. It happened only on a COLD load from a link
 * outside the site, never on feed -> article inside it, never in Safari on the
 * same phone, and never in a phone emulator. That is a page loading while iOS
 * animates in from the app the link came from: scroll and resize fire while
 * the page is still settling, the 700ms guard below is easily outlasted by an
 * app transition, and the header pinned before there was a reader to pin it
 * for — ending up out of flow and off screen. A soft navigation has no
 * transition to race, which is why moving around inside the site never showed
 * it.
 *
 * Left as a constant rather than deleted. It is the fastest way to answer
 * "is it the header again" next time, and that question took a deploy and
 * several round trips on a device none of us can debug from here.
 */
const RETRACTS_ON_SCROLL_UP = true;

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
    /* See RETRACTS_ON_SCROLL_UP: the header stays an ordinary block. */
    if (!RETRACTS_ON_SCROLL_UP) return;

    const desktop = window.matchMedia("(min-width: 640px)");
    const mountedAt = performance.now();
    let last = window.scrollY;
    let isPinned = false;

    /*
     * Nothing pins until the reader has touched the screen.
     *
     * This is the guard that matters, and the time window below is now only a
     * backstop. A scroll event says the page moved, not that anybody moved it:
     * during an app-switch transition iOS scrolls and resizes the page on its
     * own, and the header used to take that for a reader scrolling up and pin
     * itself before the page had settled. A browser cannot fake a touch.
     *
     * The listeners are `once`, so this costs one event and then nothing. The
     * cold-load case never arms at all, which is exactly right: with no reader
     * yet, the header should simply sit where it belongs.
     *
     * wheel and keydown are here for completeness rather than need — the
     * retract is mobile-only, since desktop returns early below — but they
     * cost nothing and stop this becoming a touch-only assumption if that
     * changes.
     */
    let armed = false;
    const arm = () => {
      armed = true;
    };
    const armOn = ["touchstart", "wheel", "keydown"] as const;
    for (const type of armOn) {
      window.addEventListener(type, arm, { passive: true, once: true });
    }

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

      /*
       * No reader yet, or the page is not even on screen. Both happen while
       * iOS animates in from another app, and neither is somebody scrolling.
       */
      if (!armed || document.visibilityState !== "visible") {
        last = y;
        return set(false);
      }

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
      for (const type of armOn) window.removeEventListener(type, arm);
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
      {RETRACTS_ON_SCROLL_UP && pinned && height > 0 ? (
        <div style={{ height }} aria-hidden />
      ) : null}
      <div
        ref={ref}
        className={
          RETRACTS_ON_SCROLL_UP && pinned
            ? "fixed inset-x-0 top-0 z-30 animate-[reveal_200ms_ease-out] sm:static sm:animate-none"
            : undefined
        }
      >
        {children}
      </div>
    </>
  );
}
