import { fieldLabel } from "@axonometric/contracts";
import type { BatchItem, NoteTarget } from "@axonometric/contracts";
import { Match, Option } from "effect";
import { dual } from "effect/Function";

import type { Names } from "./describe-change.ts";

/**
 * The words the engineer wrote in an item, or nothing for an item that has
 * none, such as a layout change. These are the items the Pending tab lets the
 * engineer discard while open and edit again after a rejection.
 */
export const wordsOf = (item: BatchItem): Option.Option<string> =>
  Match.value(item).pipe(
    Match.when({ kind: "note" }, ({ text }) => Option.some(text)),
    Match.when({ kind: "suggestion" }, ({ after }) => Option.some(after)),
    Match.when({ kind: "answer" }, ({ text }) => Option.some(text)),
    Match.when({ kind: "question" }, ({ text }) => Option.some(text)),
    Match.orElse(() => Option.none())
  );

const noteLine = (target: NoteTarget, text: string, names: Names): string =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      structure: ({ id }) => `Note on ${names.structure(id)}: ${text}`,
      hop: ({ id }) => `Note on hop ${names.hop(id)}: ${text}`,
      spot: ({ x, y }) => `Note at the spot ${x}, ${y}: ${text}`,
    })
  );

/** An item of words in a few words, for the Pending tab, or nothing for any other kind. */
export const describeWords: {
  (names: Names): (item: BatchItem) => Option.Option<string>;
  (item: BatchItem, names: Names): Option.Option<string>;
} = dual(2, (item: BatchItem, names: Names): Option.Option<string> =>
  Match.value(item).pipe(
    Match.when({ kind: "note" }, ({ target, text }) =>
      Option.some(noteLine(target, text, names))
    ),
    Match.when({ kind: "suggestion" }, ({ target, field, after }) =>
      Option.some(
        `Suggestion for the ${fieldLabel(field)} of ${names.structure(target.id)}: ${after}`
      )
    ),
    Match.when({ kind: "answer" }, ({ target, question, text }) =>
      Option.some(
        `Answer to ${question} on ${names.structure(target.id)}: ${text}`
      )
    ),
    Match.when({ kind: "question" }, ({ target, text }) =>
      Option.some(`New question on ${names.structure(target.id)}: ${text}`)
    ),
    Match.orElse(() => Option.none())
  )
);
