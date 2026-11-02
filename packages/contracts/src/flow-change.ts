import { Schema } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import { SomeFlowRefs, SomeHopRefs, FlowRef } from "./hop-change.ts";
import { ProvisionalId } from "./structure-change.ts";
import { oneLineText } from "./text-schemas.ts";

/** The most characters a flow's name holds. */
export const maxFlowNameLength = 80;

/** A flow's name: one line, trimmed, not longer than the limit. */
export const FlowName = oneLineText({ what: "name", max: maxFlowNameLength });

/** What the engineer sets when creating a flow. */
export const NewFlow = Schema.Struct({
  id: ProvisionalId,
  name: FlowName,
}).annotate(objectMessages("A new flow has only id and name."));

export type NewFlow = typeof NewFlow.Type;

const action = <const A extends string>(name: A) => Schema.Literal(name);

/**
 * A proposed change to the flows. `add` carries a provisional id, the name
 * and the hops the flow starts with, in order. `rename` and `hops` name a
 * flow by `flow`; `hops` sets its whole ordered list, which is how a hop
 * joins a flow, leaves it or moves within it. `reorder` sets the order of
 * the flows: the flows it lists come first, in that order.
 */
export const FlowChange = Schema.Union([
  Schema.Struct({
    action: action("add"),
    flow: NewFlow,
    hops: SomeHopRefs,
  }).annotate(objectMessages("An add has only action, flow and hops.")),
  Schema.Struct({
    action: action("rename"),
    flow: FlowRef,
    name: FlowName,
  }).annotate(objectMessages("A rename has only action, flow and name.")),
  Schema.Struct({
    action: action("hops"),
    flow: FlowRef,
    hops: SomeHopRefs,
  }).annotate(objectMessages("A hops change has only action, flow and hops.")),
  Schema.Struct({
    action: action("reorder"),
    flows: SomeFlowRefs,
  }).annotate(objectMessages("A reorder has only action and flows.")),
]).annotate({
  message:
    'expected a flow change: { action: "add", flow: { id, name }, hops: [hop ids] }, { action: "rename", flow, name }, { action: "hops", flow, hops: [hop ids] } or { action: "reorder", flows: [flow ids] }.',
});

export type FlowChange = typeof FlowChange.Type;

const equivalent = Schema.toEquivalence(FlowChange);

/** Whether two changes are the same change. */
export const sameFlowChange: {
  (b: FlowChange): (a: FlowChange) => boolean;
  (a: FlowChange, b: FlowChange): boolean;
} = dual(2, (a: FlowChange, b: FlowChange): boolean => equivalent(a, b));

/**
 * The id of the flow a change acts on: the provisional id for an add. A
 * reorder acts on the flows as a whole, so it names none.
 */
export const flowOf = (change: FlowChange): string => {
  if (change.action === "reorder") {
    return "";
  }

  return change.action === "add" ? change.flow.id : change.flow;
};

/** Whether two changes act on the same flow in the same way. */
export const sameFlowSubject: {
  (b: FlowChange): (a: FlowChange) => boolean;
  (a: FlowChange, b: FlowChange): boolean;
} = dual(
  2,
  (a: FlowChange, b: FlowChange): boolean =>
    a.action === b.action && flowOf(a) === flowOf(b)
);
