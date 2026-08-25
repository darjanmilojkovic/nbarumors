/** Shared shell for the legal and informational pages. */
export function Prose({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-x border-rule bg-surface px-4 py-8 sm:px-8">
      <h1 className="display mb-1 text-2xl text-white sm:text-3xl">{title}</h1>
      {updated && (
        <p className="mb-7 font-mono text-[11px] tracking-wider text-muted uppercase">
          Last updated {updated}
        </p>
      )}
      <div className="max-w-[68ch] space-y-4 text-[15.5px] leading-7 text-body [&_a]:text-link [&_a:hover]:underline [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:font-serif [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-white">
        {children}
      </div>
    </div>
  );
}
