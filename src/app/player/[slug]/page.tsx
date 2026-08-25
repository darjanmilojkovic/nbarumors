import { notFound } from "next/navigation";
import { RumorCard } from "@/components/RumorCard";
import { SiteHeader } from "@/components/SiteHeader";
import { playerBySlug, rumorsForPlayer } from "@/lib/queries";

export const revalidate = 300;

export default async function PlayerPage({ params }: PageProps<"/player/[slug]">) {
  const { slug } = await params;
  const player = await playerBySlug(slug);
  if (!player) notFound();

  const rumors = await rumorsForPlayer(slug);

  return (
    <>
      <SiteHeader
        playerLabel={player.fullName}
        playerHref={`/player/${player.slug}`}
      />
      <div className="mb-6 px-4 sm:px-0">
        <h1 className="display text-2xl text-white sm:text-3xl">{player.fullName}</h1>
        <p className="text-xs text-muted">
          {rumors.length} update{rumors.length === 1 ? "" : "s"}
        </p>
      </div>
      {rumors.map((r) => (
        <RumorCard key={r.id} rumor={r} />
      ))}
    </>
  );
}
