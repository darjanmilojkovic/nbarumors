import type { Metadata } from "next";
import { Prose } from "@/components/Prose";
import { WireShell } from "@/components/WireShell";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact — NBA Rumors",
  description: `How to reach ${SITE.name}, including corrections and rights enquiries.`,
};

export default function ContactPage() {
  return (
    <WireShell>
      <Prose title="Contact">
        <p>
          Email <strong>{SITE.contactEmail}</strong>.
        </p>

        <h2>Corrections</h2>
        <p>
          Summaries here are generated automatically from other outlets&apos;
          reporting, so mistakes are possible. If a post misstates something,
          send the link and what is wrong with it, and we will correct or remove
          it.
        </p>

        <h2>Rights holders</h2>
        <p>
          If you hold rights in a photograph used on the site and believe the
          licence or credit is wrong, tell us which post and we will fix the
          credit or take the image down.
        </p>

        <h2>Operator</h2>
        <p>
          {SITE.operator}
          <br />
          {SITE.address}
        </p>
      </Prose>
    </WireShell>
  );
}
