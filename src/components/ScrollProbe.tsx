"use client";

import { useEffect, useState } from "react";

/**
 * A readout for a bug that only exists on somebody else's phone.
 *
 * The masthead disappears on nbarumors.cc when a link is opened from another
 * app on iOS Chrome — every page, cold loads only. It cannot be reproduced
 * here: iOS Chrome is WKWebView, so Safari on the same phone shares its engine
 * and behaves, and desktop Chrome's phone emulation is Blink. Three fixes have
 * now been aimed at it from inference alone and two were wrong, which is a
 * worse use of the user's time than asking them to send one screenshot.
 *
 * Off unless the URL carries ?debug. Renders nothing at all otherwise, so it
 * cannot affect a reader.
 *
 * What it answers, in order of what would change the diagnosis most:
 *
 *   is the page scrolled, or is the header genuinely absent
 *   which element actually scrolls — body being the scroller is the thing
 *     `overflow-x: hidden` on body is suspected of causing on WebKit
 *   does the header exist in the DOM, and where does it think it is
 *   does any of it change over the first few seconds, which is when an
 *     app-switch transition would be settling
 */
export function ScrollProbe() {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;

    const log: string[] = [];
    const add = (s: string) => {
      log.push(s);
      /* Cap it: a scroll fires a lot and the panel has to stay readable. */
      if (log.length > 40) log.shift();
      setLines([...log]);
    };

    const de = document.documentElement;

    const snap = (label: string) => {
      const h = document.querySelector("header");
      const r = h?.getBoundingClientRect();
      /*
       * The VISUAL viewport, which is the one you are looking at.
       *
       * The first run of this probe reported the page at y=0 with the header
       * at top:0 and 114px tall, on a screen showing neither. Layout scroll
       * cannot explain that, and nothing is painted over it — the filter bar
       * below is sticky, so at y=0 it sits in its own place. What is left is
       * the visual viewport being offset from the layout viewport, which
       * window.scrollY does not report and which iOS moves on its own.
       */
      const vv = window.visualViewport;
      add(
        `${label} y=${Math.round(window.scrollY)}/${Math.round(de.scrollTop)}/${Math.round(document.body.scrollTop)} ` +
          `hdr=${r ? `${Math.round(r.top)}h${Math.round(r.height)}` : "MISSING"} ` +
          `vv=${vv ? `o${Math.round(vv.offsetTop)}p${Math.round(vv.pageTop)}h${Math.round(vv.height)}s${vv.scale.toFixed(2)}` : "none"} ` +
          `ih=${window.innerHeight}/${de.clientHeight}`,
      );
    };

    add(
      `restore=${history.scrollRestoration} scroller=${document.scrollingElement === de ? "html" : "body"} ` +
        `vp=${window.innerWidth}x${window.innerHeight}`,
    );
    add(
      `bodyOverflowX=${getComputedStyle(document.body).overflowX} htmlOverflowX=${getComputedStyle(de).overflowX}`,
    );
    snap("t0");

    const timers = [100, 500, 1500, 3000].map((ms) =>
      window.setTimeout(() => snap(`${ms}ms`), ms),
    );

    /* What StayAtTop decided, which is otherwise invisible from outside. */
    timers.push(
      window.setTimeout(() => {
        add(`-- StayAtTop --`);
        for (const s of window.__stayAtTop ?? ["(nothing logged)"]) add(s);
      }, 5000),
    );

    let scrolls = 0;
    const onScroll = () => {
      if (++scrolls <= 6) snap(`scroll#${scrolls}`);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    /* The visual viewport moves without a scroll event. Watch it directly. */
    const vv = window.visualViewport;
    let vvEvents = 0;
    const onVv = () => {
      if (++vvEvents <= 8) snap(`vv#${vvEvents}`);
    };
    vv?.addEventListener("resize", onVv);
    vv?.addEventListener("scroll", onVv);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("scroll", onScroll);
      vv?.removeEventListener("resize", onVv);
      vv?.removeEventListener("scroll", onVv);
    };
  }, []);

  if (!lines) return null;

  return (
    <pre
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        margin: 0,
        padding: "6px 8px",
        maxHeight: "45vh",
        overflow: "auto",
        background: "rgba(0,0,0,0.88)",
        color: "#4ade80",
        font: "10px/1.35 ui-monospace, monospace",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}
