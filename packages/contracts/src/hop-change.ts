import { Schema } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import { ProvisionalId, StructureId } from "./structure-change.ts";

const lineBreak = /[\n\r\u0085\u2028\u2029]/u;

const refFix = (what: string) =>
  `expected the id of a ${what}: 1 to 200 characters, with no line breaks.`;

/** An id data.mjs gives a `what`: free text on one line. */
const refId = (what: string) =>
  Schema.String.annotate({ message: refFix(what) }).check(
    Schema.isNonEmpty({ message: refFix(what) }),
    Schema.isMaxLength(200, { message: refFix(what) }),
    Schema.makeFilter((id: string) => !lineBreak.test(id), {
      message: refFix(what),
    })
  );

/** The id of a hop that data.mjs has, or of one the engineer proposed. */
export const HopRef = refId("hop");

/** The id of a flow that data.mjs has, or of one the engineer proposed. */
export const FlowRef = refId("flow");

const eachOnce = (what: string) =>
  Schema.makeFilter(
    (ids: readonly string[]) => new Set(ids).size === ids.length,
    { message: `expected each ${what} id once.` }
  );

/** A list of at least one hop id, none repeated. */
export const SomeHopRefs = Schema.NonEmptyArray(HopRef)
  .annotate({ message: "expected a list of at least one hop id." })
  .check(eachOnce("hop"));

/** A list of at least one flow id, none repeated. */
export const SomeFlowRefs = Schema.NonEmptyArray(FlowRef)
  .annotate({ message: "expected a list of at least one flow id." })
  .check(eachOnce("flow"));

/** The most characters a hop's label holds. */
export const maxHopLabelLength = 80;

const labelFix = `expected a label of 1 to ${maxHopLabelLength} characters on one line, with no space at either end.`;

/** A hop's label: one line, trimmed, not longer than the limit. */
export const HopLabel = Schema.String.annotate({ message: labelFix }).check(
  Schema.isPattern(/^\S(?:[^\r\n\u0085\u2028\u2029]*\S)?$/u, {
    message: labelFix,
  }),
  Schema.isMaxLength(maxHopLabelLength, { message: labelFix })
);

/** What the engineer sets when drawing a hop. */
export const NewHop = Schema.Struct({
  id: ProvisionalId,
  from: StructureId,
  to: StructureId,
  label: HopLabel,
}).annotate(objectMessages("A new hop has only id, from, to and label."));

export type NewHop = typeof NewHop.Type;

const action = <const A extends string>(name: A) => Schema.Literal(name);

/**
 * A proposed change to the hops. `add` carries a provisional id, the two
 * structures and the label. The other actions name a hop by `hop`. Which
 * flows a hop is in is the flows' own business: see `FlowChange`.
 */
export const HopChange = Schema.Union([
  Schema.Struct({
    action: action("add"),
    hop: NewHop,
  }).annotate(objectMessages("An add has only action and hop.")),
  Schema.Struct({
    action: action("delete"),
    hop: HopRef,
  }).annotate(objectMessages("A delete has only action and hop.")),
  Schema.Struct({
    action: action("relabel"),
    hop: HopRef,
    label: HopLabel,
  }).annotate(objectMessages("A relabel has only action, hop and label.")),
]).annotate({
  message:
    'expected a hop change: { action: "add", hop: { id, from, to, label } }, { action: "delete", hop } or { action: "relabel", hop, label }.',
});

export type HopChange = typeof HopChange.Type;

const equivalent = Schema.toEquivalence(HopChange);

/** Whether two changes are the same change. */
export const sameHopChange: {
  (b: HopChange): (a: HopChange) => boolean;
  (a: HopChange, b: HopChange): boolean;
} = dual(2, (a: HopChange, b: HopChange): boolean => equivalent(a, b));

/** The id of the hop a change acts on: the provisional id for an add. */
export const hopOf = (change: HopChange): string =>
  change.action === "add" ? change.hop.id : change.hop;

/** Whether two changes act on the same hop in the same way. */
export const sameHopSubject: {
  (b: HopChange): (a: HopChange) => boolean;
  (a: HopChange, b: HopChange): boolean;
} = dual(
  2,
  (a: HopChange, b: HopChange): boolean =>
    a.action === b.action && hopOf(a) === hopOf(b)
);

/**
 * The key a hop's provisional id goes by among the renames of a commit,
 * which also hold structure ids, so a hop and a structure never share one.
 */
export const hopRenameKey = (id: string): string => `hop:${id}`;

/** The key a flow's provisional id goes by among the renames of a commit. */
export const flowRenameKey = (id: string): string => `flow:${id}`;
