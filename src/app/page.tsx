import { RumorCard } from "@/components/RumorCard";
import { latestRumors } from "@/lib/queries";

/** Rebuild on a 5-minute cadence so cron-ingested rumors appear on their own. */
export const revalidate = 300;

export default async function HomePage() {
  const rumors = await latestRumors(30);

  return (
    <>
      <h1 className="sr-only">Latest NBA trade rumors and signings</h1>
      {rumors.length === 0 ? (
        <p className="px-4 text-muted sm:px-0">
          No rumors published yet. Run <code>npm run ingest</code> then{" "}
          <code>npm run extract</code>.
        </p>
      ) : (
        rumors.map((r) => <RumorCard key={r.id} rumor={r} />)
      )}
    </>
  );
}
