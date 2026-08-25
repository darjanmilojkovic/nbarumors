import Link from "next/link";
import { SITE } from "@/lib/site";

const LINKS = [
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/sitemap.xml", label: "Sitemap" },
];

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-rule">
      <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-5">
        <div className="rounded-sm border border-rule bg-surface px-4 py-5 sm:px-6">
          <p className="text-xs leading-relaxed text-muted">
            © {new Date().getFullYear()} {SITE.name}. Summaries are written in
            our own words from public reporting and link to their original
            sources. Team names, logos and marks belong to their respective
            owners; {SITE.name} is not affiliated with or endorsed by the NBA.
            Player photographs are used under their stated licences.
          </p>

          <p className="mt-3 text-xs text-muted">
            {SITE.name} is operated by {SITE.operator}, {SITE.address}.
          </p>

          {/*
           * No cookie banner or consent link: the site sets no cookies and
           * runs no analytics. Adding "Cookie Settings" with nothing behind it
           * would imply tracking that does not exist.
           */}
          <nav className="mt-5 flex flex-wrap gap-2.5">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full border border-rule px-3.5 py-1.5 text-xs text-body hover:border-link hover:text-link"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
