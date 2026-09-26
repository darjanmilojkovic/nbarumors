"use client";

import { useEffect, useState } from "react";

/**
 * Reopens Google's consent message so a visitor can change their answer.
 *
 * Withdrawing consent has to be as easy as giving it, and the message is gone
 * once answered — so without this the only route back is clearing cookies by
 * hand. The privacy policy points at this link by name.
 *
 * It renders only where the message applies. Google's CMP answers
 * `gdprApplies` through the IAB TCF API; outside the EEA, UK and Switzerland
 * it is false, there is no message to reopen, and a "Cookie Settings" button
 * that does nothing is worse than none — it reads as a withdrawal mechanism
 * while offering none. Rendering is client-only for the same reason, so it
 * never ships in static HTML that a blocked script would leave inert.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    /*
     * The CMP loads async from Google and can be slow, or blocked outright by
     * an extension. Poll for its TCF API rather than bet on one timing.
     */
    let asked = false;
    const check = () => {
      if (asked || typeof window.__tcfapi !== "function") return;
      asked = true;
      window.clearInterval(timer);
      window.__tcfapi("addEventListener", 2, (tcData, success) => {
        if (success && tcData?.gdprApplies) setReady(true);
      });
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
    <button
      type="button"
      className={className}
      onClick={() => {
        window.googlefc = window.googlefc || {};
        window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
        window.googlefc.callbackQueue.push(() => window.googlefc?.showRevocationMessage?.());
      }}
    >
      Cookie Settings
    </button>
  );
}
