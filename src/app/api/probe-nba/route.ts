/**
 * TEMPORARY — proves whether www.nba.com/players answers from Vercel before a
 * cron depends on it. The last nba.com source that worked from a laptop hung
 * here (see roster-nba.ts). Returns counts only. Remove once answered.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const res = await fetch("https://www.nba.com/players", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    const players = m ? (JSON.parse(m[1]).props?.pageProps?.players ?? []) : [];
    return Response.json({
      status: res.status,
      ms: Date.now() - started,
      bytes: html.length,
      players: players.length,
      withTeam: players.filter((p: { TEAM_ID?: number }) => p.TEAM_ID).length,
      dybantsa: players.find((p: { PLAYER_LAST_NAME?: string }) => p.PLAYER_LAST_NAME === "Dybantsa")?.TEAM_ABBREVIATION ?? null,
    });
  } catch (err) {
    return Response.json({ error: String(err), ms: Date.now() - started }, { status: 502 });
  }
}
