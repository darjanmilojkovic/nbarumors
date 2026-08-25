import { notFound } from "next/navigation";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { playerBySlug, rumorsForPlayer } from "@/lib/queries";

export const revalidate = 300;

export default async function PlayerPage({ params }: PageProps<"/player/[slug]">) {
  const { slug } = await params;
  const player = await playerBySlug(slug);
  if (!player) notFound();

  const rumors = await rumorsForPlayer(slug);

  return (
    <WireShell
      playerLabel={player.fullName}
      playerHref={`/player/${player.slug}`}
    >
      <div className="mb-6 px-4 pt-8 sm:px-0">
        <h1 className="display text-2xl text-white sm:text-3xl">{player.fullName}</h1>
        <p className="text-xs text-muted">
          {rumors.length} update{rumors.length === 1 ? "" : "s"}
        </p>
      </div>
      {/* Same panel the feed uses, so the column is ruled on all four sides. */}
      <div className="border-x border-rule bg-surface">
        {rumors.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            Nothing on this player yet.
          </p>
        ) : (
          rumors.map((r) => <WireItem key={r.id} rumor={r} />)
        )}
      </div>
    </WireShell>
  );
}
