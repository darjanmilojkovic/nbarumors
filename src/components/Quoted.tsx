import { Fragment } from "react";

/**
 * Set quoted speech in italic.
 *
 * A summary mixes our sentences with someone else's words, and quote marks
 * alone are easy to skim past at this size: the Wizards GM saying Anthony
 * Davis "wants to be in D.C., and we're gonna keep him there" read as part of
 * the surrounding paraphrase. Italic marks the change of voice before the
 * reader has parsed the punctuation.
 *
 * The marks stay. They are what makes it a quotation; the italic only makes
 * that visible sooner.
 *
 * Only double quotes, straight or curly. An apostrophe is not a quotation —
 * "we're" and "Kuminga's" appear in almost every summary, and matching single
 * quotes would italicise the text between two unrelated ones.
 */
const QUOTED = /(["“][^"“”]{3,}["”])/g;

/*
 * A separate, anchored pattern for testing the pieces.
 *
 * QUOTED carries the global flag, which makes .test() stateful: it resumes
 * from lastIndex and alternates between true and false down a list, so every
 * other quotation would have come out unmarked.
 */
const IS_QUOTED = /^["“][^"“”]{3,}["”]$/;

export function Quoted({ text }: { text: string }) {
  const parts = text.split(QUOTED);
  if (parts.length === 1) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        IS_QUOTED.test(part) ? (
          <em key={i} className="text-white/90 italic">
            {part}
          </em>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
