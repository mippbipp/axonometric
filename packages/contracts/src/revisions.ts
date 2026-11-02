import { Option, Schema, String as Str } from "effect";

import { formatVersion, objectMessages } from "./fields.ts";
import { Layout, JsonText } from "./layout.ts";
import { MapData } from "./map-data.ts";
import {
  ChangeId,
  LayoutChange,
  NoteText,
  Reason,
  RequiredReason,
  StructureTarget,
} from "./proposals.ts";
import { StructureChange, StructureId } from "./structure-change.ts";

/** The folder in the home folder that holds one file per revision. */
export const historyFolder = "history";

const changedFlag = Schema.optionalKey(Schema.Literal(true));

/**
 * One item a revision accepted. `kind` says what the item is, so a later
 * kind of proposal joins the union and a file written before it still reads.
 * `reason` is the why, when one was given. `changed` is true when the agent's
 * verdict was "changed": it took the item in a different form, and `reason`
 * says how.
 */
export const AcceptedItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("layout"),
    id: ChangeId,
    change: LayoutChange,
    reason: Schema.optionalKey(Reason),
    changed: changedFlag,
  }).annotate(
    objectMessages(
      "An accepted layout item has only kind, id, change, reason and changed."
    )
  ),
  Schema.Struct({
    kind: Schema.Literal("note"),
    id: ChangeId,
    target: StructureTarget,
    text: NoteText,
    reason: Schema.optionalKey(Reason),
    changed: changedFlag,
  }).annotate(
    objectMessages(
      "An accepted note has only kind, id, target, text, reason and changed."
    )
  ),
  Schema.Struct({
    kind: Schema.Literal("structure"),
    id: ChangeId,
    change: StructureChange,
    /** For an added structure: the id it has on the map now. */
    as: Schema.optionalKey(StructureId),
    reason: Schema.optionalKey(Reason),
    changed: changedFlag,
  }).annotate(
    objectMessages(
      "An accepted structure item has only kind, id, change, as, reason and changed."
    )
  ),
]).annotate({
  message:
    'expected an accepted item: { kind: "layout", id, change, reason? }, { kind: "note", id, target, text, reason? } or { kind: "structure", id, change, as?, reason? }.',
});

export type AcceptedItem = typeof AcceptedItem.Type;

/** One item a revision turned down, with the reason it did. */
export const RejectedItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("layout"),
    id: ChangeId,
    change: LayoutChange,
    reason: RequiredReason,
  }).annotate(
    objectMessages(
      "A rejected layout item has only kind, id, change and reason."
    )
  ),
  Schema.Struct({
    kind: Schema.Literal("note"),
    id: ChangeId,
    target: StructureTarget,
    text: NoteText,
    reason: RequiredReason,
  }).annotate(
    objectMessages(
      "A rejected note has only kind, id, target, text and reason."
    )
  ),
  Schema.Struct({
    kind: Schema.Literal("structure"),
    id: ChangeId,
    change: StructureChange,
    reason: RequiredReason,
  }).annotate(
    objectMessages(
      "A rejected structure item has only kind, id, change and reason."
    )
  ),
]).annotate({
  message:
    'expected a rejected item: { kind: "layout", id, change, reason }, { kind: "note", id, target, text, reason } or { kind: "structure", id, change, reason }.',
});

export type RejectedItem = typeof RejectedItem.Type;

const isoMessage =
  "expected the date and time as ISO 8601 in UTC, such as 2026-11-01T09:00:00.000Z.";

const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

const messageText = "expected the revision's message as a non-empty string.";

/**
 * `history/<n>.json`: one accepted state of the map. It is written once and
 * never rewritten. `revision` is the revision number: 1 for the first, and
 * one more for each after it, which is also the number in the file's name.
 * `data` is `data.mjs` as evaluated and `layout` the accepted layout, so a
 * revision stands alone.
 */
export const Revision = Schema.Struct({
  format: Schema.Int.annotate({
    message: `expected ${formatVersion}. Set format to ${formatVersion}, the only format this CLI reads.`,
  })
    .check(
      Schema.makeFilter(
        (version: number) => {
          if (version === formatVersion) {
            return true;
          }

          return version > formatVersion
            ? `format ${version} is newer than this axonometric reads (format ${formatVersion}). Upgrade axonometric, then try again.`
            : `expected ${formatVersion}. Set format to ${formatVersion}, the only format this CLI reads.`;
        },
        { expected: `format ${formatVersion}` }
      )
    )
    .pipe(
      Schema.annotateKey({
        messageMissingKey: `missing. Add format: ${formatVersion}.`,
      })
    ),
  revision: Schema.Int.annotate({
    message: "expected a whole number. Revisions start at 1.",
  })
    .check(
      Schema.isGreaterThanOrEqualTo(1, {
        message: "expected 1 or more. Revisions start at 1.",
      })
    )
    .pipe(
      Schema.annotateKey({
        messageMissingKey: "missing. Add the revision number, starting at 1.",
      })
    ),
  savedAt: Schema.String.annotate({ message: isoMessage })
    .check(Schema.isPattern(isoPattern, { message: isoMessage }))
    .pipe(
      Schema.annotateKey({
        messageMissingKey: "missing. Add savedAt as an ISO date and time.",
      })
    ),
  message: Schema.String.annotate({ message: messageText })
    .check(Schema.isNonEmpty({ message: messageText }))
    .pipe(
      Schema.annotateKey({
        messageMissingKey: "missing. Add the message that names this revision.",
      })
    ),
  accepted: Schema.Array(AcceptedItem).pipe(
    Schema.annotateKey({
      messageMissingKey:
        "missing. Add accepted: [] to hold the accepted items.",
    })
  ),
  rejected: Schema.Array(RejectedItem).pipe(
    Schema.annotateKey({
      messageMissingKey:
        "missing. Add rejected: [] to hold the rejected items.",
    })
  ),
  data: MapData.pipe(
    Schema.annotateKey({
      messageMissingKey: "missing. Add data: the map's data.mjs as evaluated.",
    })
  ),
  layout: Layout.pipe(
    Schema.annotateKey({
      messageMissingKey: "missing. Add layout: the accepted layout.",
    })
  ),
}).annotate(
  objectMessages(
    "A revision has only format, revision, savedAt, message, accepted, rejected, data and layout."
  )
);

export type Revision = typeof Revision.Type;

/** The text of a revision file, decoded. */
export const RevisionFile = JsonText.pipe(Schema.decodeTo(Revision));

/** The name of revision `n`'s file: at least four digits, so names sort. */
export const revisionFileName = (n: number): `${string}.json` =>
  `${Str.padStart(4, "0")(String(n))}.json`;

const revisionName = /^(?<digits>\d{4,})\.json$/u;

/**
 * The revision number a file name stands for, or nothing when the name isn't
 * the one `revisionFileName` makes: temporary files, notes and numbers with
 * extra zeros don't count.
 */
export const parseRevisionFileName = (name: string): Option.Option<number> => {
  const digits = Option.fromNullishOr(revisionName.exec(name)?.groups?.digits);
  const n = Option.map(digits, Number);

  return Option.filter(
    n,
    (found) =>
      Number.isSafeInteger(found) &&
      found >= 1 &&
      revisionFileName(found) === name
  );
};
