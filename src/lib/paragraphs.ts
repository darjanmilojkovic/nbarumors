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
    .replace(/\b(Jr|Sr|St|Mr|Dr|vs|No|[A-Z])\./g, `$1${DOT}`);

  const parts = masked.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [masked];
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

  const out: string[] = [];
  let current = "";
  for (const sentence of sentences(text)) {
    current = current ? `${current} ${sentence}` : sentence;
    if (current.length >= TARGET_PARA_CHARS) {
      out.push(current);
      current = "";
    }
  }
  if (current) {
    /*
     * A trailing fragment joins the paragraph above rather than standing as a
     * one-line orphan, unless that would make a paragraph twice the target.
     */
    const last = out[out.length - 1];
    if (last && current.length < 90 && last.length + current.length < TARGET_PARA_CHARS * 2) {
      out[out.length - 1] = `${last} ${current}`;
    } else {
      out.push(current);
    }
  }
  return out.length ? out : [text];
}
