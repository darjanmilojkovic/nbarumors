import Image from "next/image";
import { notFound } from "next/navigation";
import { RumorCard } from "@/components/RumorCard";
import { rumorsForTeam, teamBySlug } from "@/lib/queries";

export const revalidate = 300;

export default async function TeamPage({ params }: PageProps<"/team/[slug]">) {
  const { slug } = await params;
  const team = await teamBySlug(slug);
  if (!team) notFound();

  const rumors = await rumorsForTeam(slug);

  return (
    <>
      <div className="mb-6 flex items-center gap-4 px-4 sm:px-0">
        <Image
          src={team.logoUrl}
          alt=""
          width={64}
          height={64}
          className="h-12 w-12 object-contain sm:h-16 sm:w-16"
          unoptimized
        />
        <div>
          <h1 className="display text-2xl text-white sm:text-3xl">
            {team.city} {team.name}
          </h1>
          <p className="text-xs text-muted">
            {team.conference}ern Conference · {team.division} · {rumors.length} update
            {rumors.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {rumors.length === 0 ? (
        <p className="px-4 text-muted sm:px-0">No rumors for this team yet.</p>
      ) : (
        rumors.map((r) => <RumorCard key={r.id} rumor={r} />)
      )}
    </>
  );
}
