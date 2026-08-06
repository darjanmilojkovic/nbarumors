import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { rumors } from "@/db/schema";
import { RumorCard } from "@/components/RumorCard";
import { latestRumors } from "@/lib/queries";

export const revalidate = 300;

export default async function RumorPage({ params }: PageProps<"/rumor/[slug]">) {
  const { slug } = await params;

  const [row] = await db
    .select({ id: rumors.id })
    .from(rumors)
    .where(eq(rumors.slug, slug))
    .limit(1);
  if (!row) notFound();

  // Small dataset — pull the feed and pick, rather than a second hydrate path.
  const feed = await latestRumors(200);
  const rumor = feed.find((r) => r.id === row.id);
  if (!rumor) notFound();

  return <RumorCard rumor={rumor} />;
}
