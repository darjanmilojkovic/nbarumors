/** AdSense publisher ID. Also in public/ads.txt — keep the two in step. */
export const ADSENSE_PUBLISHER_ID = "pub-1522696528648368";

/**
 * Where Google's consent message is shown: the EEA, the UK and Switzerland.
 * Google's European regulations message cannot be targeted anywhere else, so
 * this list is where consent is asked for — and therefore the only place the
 * defaults below can start as denied without denying for good.
 */
const CONSENT_REGIONS = [
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // rest of the EEA
  "IS", "LI", "NO",
  "GB", "CH",
];

const CONSENT_DEFAULT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted'
});
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  region: ${JSON.stringify(CONSENT_REGIONS)},
  wait_for_update: 500
});
`;

/*
 * The AdSense tag, as AdSense issues it (async, crossorigin=anonymous), but
 * inserted from script rather than written as a <script async src>. React
 * hoists every async script with a src to the top of <head>, above the
 * defaults — found in a production build of the plain tag. A cached copy could
 * then run before anything was denied. Inserting it here makes "after the
 * defaults" a fact of execution, not of markup order.
 */
const ADSENSE_LOADER = `
(function () {
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${ADSENSE_PUBLISHER_ID}';
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
})();
`;

/**
 * Cookie consent (Google's CMP, from AdSense Privacy & messaging) and the
 * Consent Mode defaults it updates.
 *
 * Order matters more than anything else in this file:
 *
 *   1. consent defaults              <- here, first thing in <head>
 *   2. the AdSense tag, which        <- here
 *      delivers Google's message
 *   3. gtag.js and gtag('config')    <- Analytics.tsx, after hydration
 *
 * Google reads the consent state as it was when `config` ran, so the defaults
 * have to be in place before gtag.js arrives. Ship them in the wrong order and
 * the banner still appears, the site still looks compliant, and analytics
 * storage is granted the whole time — a failure with no symptom.
 *
 * The defaults are split by region. In CONSENT_REGIONS everything starts
 * denied and only Google's message can grant it; everywhere else no message is
 * shown, so everything starts granted. A single global "denied" would never be
 * lifted outside Europe — nothing there asks. The region-scoped default wins
 * over the global one wherever both match, regardless of order.
 *
 * The message itself is what writes the updates: "consent mode for advertising
 * purposes" and "for analytics purposes" are switched on in the European
 * regulations message settings in AdSense. If either is ever switched off,
 * Europeans who accept stay denied for that purpose — nothing here would fail.
 *
 * These are raw <script> tags rendered into <head> rather than next/script,
 * which is the obvious tool and the wrong one here. Every next/script strategy,
 * `beforeInteractive` included, leaves only a <link rel=preload> in the head and
 * emits the tag itself at the top of <body>, below Next's own runtime chunks —
 * verified in a production build, not assumed. That is too late and too low for
 * the defaults. The AdSense tag is async, as Google ships it, and inserted by
 * the same script straight after the defaults — see ADSENSE_LOADER.
 *
 * `wait_for_update` holds tags briefly so a returning visitor who has already
 * consented is not counted as denied while the message script reads its cookie.
 *
 * Whether this tag shows ads is decided in AdSense, not here: with Auto ads
 * off and no ad units on the page it serves the consent message and nothing
 * else. Turning Auto ads on is shipping ads — flip SITE.usesAds with it.
 */
export function Consent() {
  return (
    <>
      {/* One script, defaults first. The AdSense tag is also what delivers
          the consent message: Google shows a published Privacy & messaging
          message on any page that carries it. */}
      <script dangerouslySetInnerHTML={{ __html: CONSENT_DEFAULT + ADSENSE_LOADER }} />
    </>
  );
}
