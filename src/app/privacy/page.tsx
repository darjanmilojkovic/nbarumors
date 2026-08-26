import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { WireShell } from "@/components/WireShell";
import { SITE, lastUpdated } from "@/lib/site";

export const metadata: Metadata = {
  // The layout template appends the site name; spelling it out again doubled it.
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description: `How ${SITE.name} handles personal data.`,
};

export default function PrivacyPage() {
  return (
    <WireShell>
      <Prose title="Privacy Policy" updated={lastUpdated}>
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
        {!SITE.usesAnalytics && (
          <p>
            We do not run analytics, advertising or third-party tracking
            scripts. No profile of you is built or sold.
          </p>
        )}
        {!SITE.usesCookies && (
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
          published news articles. Only that article text is sent — never
          anything about you, because we hold nothing about you.
        </p>

        <h2>Your rights</h2>
        <p>
          Data-protection law gives you rights to access, correct and erase
          personal data held about you. We hold none, so in practice there is
          nothing to request. If you believe otherwise, contact us and we will
          look into it.
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
