import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { WireShell } from "@/components/WireShell";
import { SITE, privacyLastUpdated } from "@/lib/site";

export const metadata: Metadata = {
  // The layout template appends the site name; spelling it out again doubled it.
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description: `How ${SITE.name} handles personal data.`,
};

export default function PrivacyPage() {
  return (
    <WireShell>
      <Prose title="Privacy Policy" updated={privacyLastUpdated}>
        <p>
          This policy explains what {SITE.name} does with personal data. It is
          written to describe how the site actually works today, and it will be
          updated if that changes.
        </p>
        <p>
          {SITE.operator}, {SITE.address}, is the data controller for this site
          and is established in Sweden, so the EU General Data Protection
          Regulation applies to it.
        </p>

        <h2>What we collect</h2>
        <p>
          <strong>No account is required and none can be created.</strong> We do
          not ask for your name, email address, or any other personal detail,
          and there is no login, newsletter or comment system.
        </p>
        {SITE.usesAnalytics ? (
          <>
            <p>
              <strong>Nothing runs until you say so.</strong> The first time
              you visit, a banner asks whether you accept cookies. Until you
              accept, analytics is switched off and no cookies are set. If you
              decline, that is the end of it — the site works exactly the same.
            </p>
            <p>
              If you accept, we use Google Analytics to count visits and see
              which pages are read, so we know what to write more of. It records
              the page you are on, roughly where in the world you are, and what
              kind of device and browser you use. We never send it your name or
              email, because we do not have them.
            </p>
            <p>
              Google processes that data on our behalf and may transfer it to
              servers outside the EU. See{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google&apos;s privacy policy
              </a>
              . You can also opt out on every site that uses it with
              Google&apos;s{" "}
              <a
                href="https://tools.google.com/dlpage/gaoptout"
                target="_blank"
                rel="noopener noreferrer"
              >
                browser add-on
              </a>
              .
            </p>
            {SITE.usesAds ? (
              <p>
                We also show advertising
                {SITE.adProvider ? `, served by ${SITE.adProvider}` : ""}. If
                you accept advertising cookies, the ads you see may be selected
                based on your browsing rather than shown at random. Declining
                that category leaves the ads in place but stops them being
                personalised.
              </p>
            ) : (
              <p>
                We do not run advertising and we do not sell anything about you.
              </p>
            )}
          </>
        ) : (
          <p>
            We do not run analytics, advertising or third-party tracking
            scripts. No profile of you is built or sold.
          </p>
        )}
        {SITE.usesCookies ? (
          <>
            <h2>Cookies and your choice</h2>
            <p>
              Once you accept, Google Analytics sets cookies in your browser to
              tell one visit apart from the next. They hold a random identifier
              — nothing that names you. Our consent banner also stores your
              answer, so you are not asked again on every page; that one is
              strictly necessary and is the only thing stored if you decline.
            </p>
            <p>
              <strong>You can change your mind at any time.</strong> Use the
              Cookie Settings link at the bottom of any page to review or
              withdraw what you have accepted. Withdrawing takes effect
              immediately and is as easy as accepting was.
            </p>
          </>
        ) : (
          <p>
            <strong>We do not set cookies.</strong> Because of that there is no
            cookie banner and no consent settings to manage — there is nothing
            to consent to.
          </p>
        )}

        <h2>Server logs</h2>
        <p>
          The site is hosted on Vercel, which records standard request logs
          (IP address, user agent, requested URL, timestamp) for security and
          operational purposes. We do not use those logs to identify
          individuals. See{" "}
          <a
            href="https://vercel.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Vercel&apos;s privacy policy
          </a>{" "}
          for their retention practices.
        </p>

        <h2>Content loaded from other services</h2>
        <p>
          Pages embed team logos from the NBA&apos;s content network and player
          photographs from Wikimedia Commons. Your browser requests those files
          directly from those services, which means they can see your IP
          address and user agent, as they would for any image on the web.
        </p>

        <h2>Third parties</h2>
        <p>
          Summaries are produced using Anthropic&apos;s API from publicly
          published news articles. Only that article text is sent — nothing
          about you or your visit goes to Anthropic.
        </p>

        <h2>Why we are allowed to do this</h2>
        <p>
          {SITE.usesAnalytics
            ? "Analytics" + (SITE.usesAds ? " and advertising run" : " runs") +
              " on your consent, and on nothing else — that is the lawful basis, which is why the banner comes first and why withdrawing it stops the processing. "
            : ""}
          The request logs described above are kept on our legitimate interest
          in keeping the site up and secure.
        </p>

        <h2>Your rights</h2>
        <p>
          Data-protection law gives you rights to access, correct and erase
          personal data held about you. We hold no account or contact details,
          so for most of those rights there is nothing to hand over.
          {SITE.usesAnalytics
            ? " The analytics data described above is not tied to a name or an" +
              " email, so we cannot pick your visits out of it to show or" +
              " delete them. Withdrawing consent in Cookie Settings is what" +
              " stops it being collected. Contact us either way and we will" +
              " look into it."
            : " If you believe otherwise, contact us and we will look into it."}
        </p>
        <p>
          You also have the right to complain to a data-protection supervisory
          authority. In Sweden that is the Swedish Authority for Privacy
          Protection (Integritetsskyddsmyndigheten,{" "}
          <a
            href="https://www.imy.se"
            target="_blank"
            rel="noopener noreferrer"
          >
            imy.se
          </a>
          ); if you live elsewhere in the EU or EEA you may complain to the
          authority where you live.
        </p>

        <h2>Contact</h2>
        <p>
          {SITE.operator}, {SITE.address}. Email {SITE.contactEmail}.
        </p>
      </Prose>
    </WireShell>
  );
}
