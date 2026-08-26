"use client";

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
export function StickyMasthead({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    let last = window.scrollY;

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
      /*
       * A small threshold, or the header flickers on the elastic bounce at the
       * top of the page and on the one-pixel jitter of a trackpad.
       */
      if (Math.abs(y - last) < 6) return;
      const goingUp = y < last;
      last = y;
      apply(goingUp || y < 8);
    };

    apply(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    desktop.addEventListener("change", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      desktop.removeEventListener("change", onScroll);
    };
  }, []);

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
