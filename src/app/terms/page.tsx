import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/Prose";
import { WireShell } from "@/components/WireShell";
import { SITE, lastUpdated } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  alternates: { canonical: "/terms" },
  description: `The terms that apply to using ${SITE.name}.`,
};

export default function TermsPage() {
  return (
    <WireShell>
      <Prose title="Terms of Use" updated={lastUpdated}>
        <p>By using {SITE.name} you accept the terms below.</p>

        <h2>What this site is</h2>
        <p>
          {SITE.name} aggregates publicly reported NBA transfer news. Every item
          is <strong>summarized in our own words</strong> from public reporting
          and links to its original source. We do not republish source articles.
        </p>
        <p>
          Summaries are generated automatically by software and are not
          individually checked by a human before publication. They may contain
          errors, omissions or misreadings of the underlying report.{" "}
          <strong>
            Always treat the linked original as authoritative, not our summary.
          </strong>
        </p>

        <h2>Rumors are rumors</h2>
        <p>
          Much of what appears here is speculation reported by others. A post
          marked <strong>Developing</strong> means exactly that — it is not a
          statement that a move will happen or has happened. The source-strength
          meter reflects how firmly something is reported and how many outlets
          carry it. It is not a prediction, a probability, and it is not
          betting advice.
        </p>

        <h2>Attribution and third-party rights</h2>
        <p>
          NBA team names, logos and marks are the property of their respective
          owners and are used here to identify the teams a report concerns.
          {SITE.name} is not affiliated with, endorsed by, or sponsored by the
          National Basketball Association or any of its teams.
        </p>
        <p>
          Player photographs are used under the licences their creators
          published them with, and each carries its required credit. If you hold
          rights in an image and believe it is used incorrectly, contact us and
          we will correct or remove it promptly.
        </p>

        <h2>Cookies and your data</h2>
        <p>
          This site uses cookies for analytics
          {SITE.usesAds ? " and advertising" : ""}, and asks for your consent
          before setting them. You can accept or decline, and change that
          answer at any time through the Cookie Settings link in the footer.
          Declining costs you nothing: every page works the same either way.
          What we collect and why is set out in our{" "}
          <Link href="/privacy">Privacy Policy</Link>, which forms part of
          these terms.
        </p>
        {SITE.usesAds && (
          <p>
            Pages carry advertising
            {SITE.adProvider ? ` served by ${SITE.adProvider}` : ""}. Adverts
            are supplied by a third party and are not endorsements: we do not
            check advertisers or the products they promote, and any dealing you
            have with one is between you and them. Sponsored placements, if we
            ever run them, are labelled as such.
          </p>
        )}

        <h2>Our content</h2>
        <p>
          The summaries, page design and code are ours. You are welcome to link
          to and quote briefly from the site with attribution. Wholesale copying
          or automated scraping of the summaries is not permitted.
        </p>

        <h2>No warranty</h2>
        <p>
          The site is provided as is, without warranty of any kind. To the
          fullest extent permitted by law, we are not liable for any loss
          arising from reliance on anything published here.
        </p>

        <h2>Corrections</h2>
        <p>
          If something here is wrong, tell us at {SITE.contactEmail} and we will
          fix or remove it.
        </p>

        <h2>Contact</h2>
        <p>
          {SITE.operator}, {SITE.address}.
        </p>
      </Prose>
    </WireShell>
  );
}
