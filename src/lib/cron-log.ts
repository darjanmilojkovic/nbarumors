import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cronRuns } from "@/db/schema";

/**
 * Record that a cron fired, what it did, and whether it worked.
 *
 * Wraps a handler rather than being called from inside one, so a job cannot
 * report success and then throw, and cannot forget to report at all. The row
 * is written BEFORE the work starts, which is what makes a hang visible: a run
 * that never finished leaves `finished_at` and `ok` null rather than leaving
 * nothing.
 *
 * Never throws. A logging table that can break the job it logs is worse than
 * no logging table, and every one of these jobs is more important than the
 * record of it — so a failure to write the row is swallowed and the handler
 * runs regardless.
 */
export async function recordRun<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();

  let id: number | null = null;
  try {
    const [row] = await db
      .insert(cronRuns)
      .values({ name })
      .returning({ id: cronRuns.id });
    id = row?.id ?? null;
  } catch {
    /* Logging is not the job. */
  }

  const finish = async (ok: boolean, detail: unknown) => {
    if (id == null) return;
    try {
      await db
        .update(cronRuns)
        .set({
          ok,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          /* Truncated: a run's result is for reading, not for storage. */
          detail: JSON.stringify(detail).slice(0, 2000),
        })
        .where(eq(cronRuns.id, id));
    } catch {
      /* As above. */
    }
  };

  try {
    const result = await run();
    await finish(true, result);
    return result;
  } catch (err) {
    await finish(false, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
