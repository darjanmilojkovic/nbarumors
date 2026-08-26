/**
 * Break a summary into paragraphs.
 *
 * Summaries used to be two sentences and a single block was right for them.
 * Now that a post takes in later reports they run to four or five — 710
 * characters on the Josh Hart extension — and at a 62-character measure that
 * is a twelve-line wall with no way in.
 *
 * Two sources of truth, in order. A summary that carries its own blank lines
 * is broken where the writer chose, which is always better than where a rule
 * would guess. Everything written before that was asked for falls back to
 * grouping sentences, which is worth doing because the alternative is not a
 * better break, it is no break at all.
 */

/** Below this a summary is a paragraph, and splitting it invents a rhythm. */
const MIN_SPLIT_CHARS = 320;

/** Roughly four lines at the body measure. */
const TARGET_PARA_CHARS = 240;

/**
 * Split on sentence ends only.
 *
 * "Jr." and the decimal point both look like full stops and are not. Both
 * have caused real damage here before: one produced "Memphis sent Jaren
 * Jackson Jr." as a whole summary, the other turned "averaging 19.5 points"
 * into "19. 5 points" across a batch of rewrites.
 */
function sentences(text: string): string[] {
  const DOT = "\u0000";
  const masked = text
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    /*
     * A full stop with a lowercase letter hard against it is inside a word,
     * not between two sentences: NBA.com, Heavy.com, bballrumors.com. Without
     * this the Klay Thompson summary broke as "NBA. com has reported".
     */
    .replace(/\.(?=[a-z])/g, DOT)
    .replace(/\b(Jr|Sr|St|Mr|Dr|vs|No|[A-Z])\./g, `$1${DOT}`);

  /*
   * Closing punctuation belongs to the sentence it closes. Ending the match
   * at the full stop left a quote mark to open the next one, and rejoining put
   * a space before it: 'keep him there. " Kevin O'Connor reports'.
   */
  const parts = masked.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g) ?? [masked];
  return parts
    .map((s) => s.split(DOT).join(".").trim())
    .filter(Boolean);
}

export function toParagraphs(body: string): string[] {
  const authored = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (authored.length > 1) return authored;

  const text = authored[0] ?? body.trim();
  if (text.length <= MIN_SPLIT_CHARS) return [text];

  const parts = sentences(text);
  if (parts.length < 2) return [text];

  /*
   * Decide how many paragraphs, then cut at the sentence boundaries nearest to
   * where they would fall if the text divided evenly.
   *
   * Filling paragraphs greedily to a fixed size does not work here. A
   * 413-character Lillard summary of three sentences filled one paragraph to
   * 334 and left 78 over, and the rule that folded a short remainder back in
   * to avoid an orphan then rebuilt the block it had just split. Choosing the
   * cut points first cannot fail that way: it gives 158 and 255, which is the
   * trade in one paragraph and the reasoning in the next.
   */
  const count = Math.max(2, Math.round(text.length / TARGET_PARA_CHARS));
  const paraCount = Math.min(count, parts.length);

  // Where each sentence ends, as a running character offset.
  const ends: number[] = [];
  let running = 0;
  for (const s of parts) {
    running += s.length + 1;
    ends.push(running);
  }

  const cuts = new Set<number>();
  for (let i = 1; i < paraCount; i++) {
    const ideal = (text.length * i) / paraCount;
    let best = 0;
    // Never cut at the very end, and never twice in the same place.
    for (let j = 0; j < parts.length - 1; j++) {
      if (cuts.has(j)) continue;
      if (Math.abs(ends[j] - ideal) < Math.abs(ends[best] - ideal) || cuts.has(best)) best = j;
    }
    cuts.add(best);
  }

  const out: string[] = [];
  let current: string[] = [];
  parts.forEach((sentence, i) => {
    current.push(sentence);
    if (cuts.has(i)) {
      out.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) out.push(current.join(" "));

  return out.length ? out : [text];
}
