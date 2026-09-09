"use client";

import { useEffect, useState } from "react";

/**
 * Reopens the CookieHub preference centre.
 *
 * Withdrawing consent has to be as easy as giving it, and CookieHub's own
 * banner is gone once answered — so without this the only route back is
 * clearing cookies by hand. The privacy policy points at this link by name.
 *
 * It renders nothing until CookieHub is actually there. A "Cookie Settings"
 * link that does nothing when clicked is worse than no link: it reads as a
 * withdrawal mechanism while offering none. Rendering is client-only for the
 * same reason, so it never ships in static HTML that a blocked CDN would leave
 * inert.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    /*
     * The loader is in <head>, but it is a third-party request that can be
     * slow, or blocked outright by an extension. Poll rather than bet on one
     * timing — including the first check, which runs on the interval instead
     * of in the effect body so this never sets state during the effect.
     */
    const check = () => {
      if (typeof window.cookiehub?.openSettings === "function") {
        setReady(true);
        window.clearInterval(timer);
      }
    };
    const timer = window.setInterval(check, 200);
    const giveUp = window.setTimeout(() => window.clearInterval(timer), 10000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, []);

  if (!ready) return null;

  return (
    <button type="button" className={className} onClick={() => window.cookiehub?.openSettings()}>
      Cookie Settings
    </button>
  );
}
