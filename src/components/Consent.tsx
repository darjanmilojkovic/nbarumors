/** CookieHub domain code, from the loader URL in the CookieHub dashboard. */
const COOKIEHUB_ID = "696d1106";

/** CookieHub's category ID for analytics. Matches the dashboard's category. */
const ANALYTICS_CATEGORY = "analytics";

const CONSENT_DEFAULT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});
`;

const COOKIEHUB_INIT = `
(function () {
  var last = null;
  function sync() {
    var ch = window.cookiehub;
    var value = (ch && ch.hasConsented('${ANALYTICS_CATEGORY}')) ? 'granted' : 'denied';
    // onAllow fires once per category, so without this a single click on
    // "Allow all" pushes the same update six times.
    if (value === last) return;
    last = value;
    gtag('consent', 'update', { analytics_storage: value });
  }
  var cpm = {
    onInitialise: sync,
    onStatusChange: sync,
    onAllow: sync,
    onRevoke: sync
  };
  document.addEventListener('DOMContentLoaded', function () {
    if (window.cookiehub) window.cookiehub.load(cpm);
  });
})();
`;

/**
 * Cookie consent (CookieHub) and the Google Consent Mode bridge.
 *
 * Order matters more than anything else in this file:
 *
 *   1. consent defaults, denied      <- here, first thing in <head>
 *   2. the CookieHub banner          <- here
 *   3. gtag.js and gtag('config')    <- Analytics.tsx, after hydration
 *
 * Google reads the consent state as it was when `config` ran, so the defaults
 * have to be in place before gtag.js arrives. Ship them in the wrong order and
 * the banner still appears, the site still looks compliant, and analytics
 * storage is granted the whole time — a failure with no symptom.
 *
 * These are raw <script> tags rendered into <head> rather than next/script,
 * which is the obvious tool and the wrong one here. Every next/script strategy,
 * `beforeInteractive` included, leaves only a <link rel=preload> in the head and
 * emits the tag itself at the top of <body>, below Next's own runtime chunks —
 * verified in a production build, not assumed. That is too late and too low for
 * a consent manager. Raw and render-blocking in the head is the point: nothing
 * else on the page should run before the banner knows what it is allowed to do.
 *
 * `wait_for_update` holds tags briefly so a returning visitor who has already
 * consented is not counted as denied while CookieHub reads its own cookie.
 *
 * CookieHub's own Google Consent Mode is on — accepting the banner produces a
 * second, richer update carrying all seven Google signals, ours for
 * analytics_storage and then theirs for the rest. The callbacks below are kept
 * anyway rather than leaning on a setting in someone else's console: updates
 * are idempotent, so the overlap costs nothing. What is NOT redundant is the
 * default above — on a first visit CookieHub emits no signal at all, so without
 * it gtag would run under Google's implicit grant and set cookies immediately.
 *
 * The ad_* defaults are denied and stay denied: no ads run yet. When they do,
 * CookieHub already grants them on accept, so the work is in SITE.usesAds and
 * the privacy copy, not here.
 */
export function Consent() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CONSENT_DEFAULT }} />
      {/* Blocking is the requirement, not an oversight: async would let
          gtag.js win the race and set cookies before consent is known, the
          exact bug this file exists to prevent. It is also how CookieHub
          ships its own snippet. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src={`https://cdn.cookiehub.eu/c2/${COOKIEHUB_ID}.js`} />
      <script dangerouslySetInnerHTML={{ __html: COOKIEHUB_INIT }} />
    </>
  );
}
