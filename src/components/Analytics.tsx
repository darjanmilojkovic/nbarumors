import Script from "next/script";

/**
 * Google Analytics 4.
 *
 * `next/script` with the default afterInteractive strategy rather than the
 * raw <script async> from the GA snippet: Next hoists and dedupes the tag
 * across client-side navigations, so it loads once per visit instead of once
 * per route change. The inline half has to keep its stable `id` for the same
 * reason — without it Next cannot tell one inline script from another and
 * re-runs it.
 *
 * Page views on route changes are handled by GA's own Enhanced measurement
 * (History-based events), which is on by default for new properties. If it is
 * ever switched off in the GA console, only the first page of a visit will be
 * counted and this file has to send page_view manually.
 */
export const GA_MEASUREMENT_ID = "G-0T19CGNPMR";

export function Analytics() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga-init">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_MEASUREMENT_ID}');
      `}</Script>
    </>
  );
}
