import { Array as Arr, Option, Result, String as Str } from "effect";
import { dual } from "effect/Function";

import {
  addedFlowIds,
  addedHopIds,
  frozenFlowChanges,
  frozenHopChanges,
  openFlowChanges,
  openHopChanges,
  withoutOpenHop,
} from "./connection-held.ts";
import { flowActionOf } from "./flow-actions.ts";
import { flowOf, sameFlowChange, sameFlowSubject } from "./flow-change.ts";
import type { FlowChange } from "./flow-change.ts";
import { flowIsCurrent } from "./flow-effects.ts";
import { hopActionOf } from "./hop-actions.ts";
import { hopOf, sameHopChange, sameHopSubject } from "./hop-change.ts";
import type { HopChange } from "./hop-change.ts";
import { hopIsCurrent } from "./hop-effects.ts";
import type { MapData } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { newChangeId } from "./proposals.ts";
import type {
  ChangeId,
  FlowProposal,
  HopProposal,
  Proposals,
} from "./proposals.ts";
import { proposeInto } from "./propose-engine.ts";
import type { ProposalKind } from "./propose-engine.ts";
import { provisionalIdOf } from "./structure-change.ts";

/**
 * What a hop or flow proposal is checked against.
 *
 * - `data` is the map as proposed, so a structure, hop or flow an earlier
 *   proposal adds is known to later ones.
 * - `base` is the map once only the frozen items apply, which is what an open
 *   proposal lands on. A change that leaves a field as `base` has it takes
 *   the open proposal away.
 */
export interface ConnectionWorld {
  readonly data: Pick<MapData, "structures" | "hops" | "flows" | "chapters">;
  readonly base: Pick<MapData, "hops" | "flows">;
}

const hopsOpen = (proposals: Proposals): readonly HopProposal[] =>
  proposals.hops ?? [];

const flowsOpen = (proposals: Proposals): readonly FlowProposal[] =>
  proposals.flows ?? [];

const noHop = (id: string) =>
  `No hop in the map has the id "${id}", so there is nothing to change.`;

const noFlow = (id: string) =>
  `No flow in the map has the id "${id}", so there is nothing to change.`;

/** The hop ids the map has, proposed ones included. */
const hopIdsIn = (world: ConnectionWorld) =>
  new Set(Arr.map(world.data.hops, ({ id }) => id));

const flowIdsIn = (world: ConnectionWorld) =>
  new Set(Arr.map(world.data.flows, ({ id }) => id));

/** The hops proposed for deletion, open or waiting in a batch. */
const removedHopsIn = (proposals: Proposals): ReadonlySet<string> =>
  new Set(
    Arr.flatMap(
      [...openHopChanges(proposals), ...frozenHopChanges(proposals)],
      (change) => (change.action === "delete" ? [change.hop] : [])
    )
  );

// ─── hops ──────────────────────────────────────────────────────────────────

/** Why `change` can't be proposed against `world`, or nothing. */
const hopWorldRefusal = (
  world: ConnectionWorld,
  change: HopChange
): Option.Option<string> => {
  if (change.action !== "add") {
    return hopIdsIn(world).has(change.hop)
      ? Option.none()
      : Option.some(noHop(change.hop));
  }

  const { hop } = change;

  if (hopIdsIn(world).has(hop.id)) {
    return Option.some(`The map already has a hop with the id "${hop.id}".`);
  }

  if (hop.from === hop.to) {
    return Option.some(
      "A hop joins two different structures. Drop on another structure."
    );
  }

  const structures = new Set(Arr.map(world.data.structures, ({ id }) => id));

  return Option.map(
    Arr.findFirst([hop.from, hop.to], (end) => !structures.has(end)),
    (end) => `No structure in the map has the id "${end}".`
  );
};

/** An open hop add changed in the one field `change` names, or taken off with a delete. */
const editedHopAdd = (
  open: readonly HopProposal[],
  change: HopChange
): Option.Option<readonly HopProposal[]> => {
  const id = hopOf(change);

  const found = Arr.findFirst(
    open,
    ({ change: held }) => held.action === "add" && held.hop.id === id
  );

  return Option.flatMap(found, (proposal) => {
    const { change: made } = proposal;

    if (made.action !== "add") {
      return Option.none();
    }

    if (change.action === "delete") {
      return Option.some(Arr.filter(open, (other) => other.id !== proposal.id));
    }

    return change.action === "relabel"
      ? Option.some(
          Arr.map(open, (other) =>
            other.id === proposal.id
              ? { ...other, change: hopActionOf(made).withText(change.label) }
              : other
          )
        )
      : Option.none();
  });
};

/** What the propose engine needs to know about hop proposals on `world`. */
const hopKind = (world: ConnectionWorld): ProposalKind<HopChange> => ({
  noun: "hop",
  open: hopsOpen,
  withOpen: (held, hops) => ({ ...held, revision: held.revision + 1, hops }),
  targetOf: hopOf,
  isAdd: (change) => change.action === "add",
  sameChange: sameHopChange,
  sameSubject: sameHopSubject,
  waitingAdds: (held) => addedHopIds(frozenHopChanges(held)),
  edited: editedHopAdd,
  refusal: (change) => hopWorldRefusal(world, change),
  isCurrent: (change) => hopIsCurrent(world.base, change),
});

/**
 * Sets the open hop proposal `id` to `change`: how the page draws a hop,
 * deletes or relabels one. The rules are those of `proposeInto`. A delete of
 * a hop that is only proposed takes its proposal away, and the open flows
 * that listed it lose it. A change fails, and changes nothing, when it names
 * a hop or structure the map lacks, or joins a structure to itself.
 */
export const proposeHop = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: HopChange;
  readonly world: ConnectionWorld;
}): Result.Result<Proposals, string> => {
  const added = Result.map(
    proposeInto({ kind: hopKind(world), proposals, id, change }),
    (next) =>
      change.action === "delete" ? withoutOpenHop(next, hopOf(change)) : next
  );

  return added;
};

/** A fresh provisional id for a hop called `label`, such as `reads-config-4f2a`. */
export const newHopId = (label: string): string =>
  provisionalIdOf(label, Str.slice(0, 4)(newChangeId()));

// ─── flows ─────────────────────────────────────────────────────────────────

/** Why `change` can't be proposed against `world`, or nothing. */
const flowWorldRefusal = (
  world: ConnectionWorld,
  proposals: Proposals,
  change: FlowChange
): Option.Option<string> => {
  const hops = hopIdsIn(world);
  const flows = flowIdsIn(world);
  const action = flowActionOf(change);

  const unknownHop = Option.map(
    Arr.findFirst(action.hops(), (hop) => !hops.has(hop)),
    noHop
  );

  const removed = removedHopsIn(proposals);

  // The hops a flow already lists stay as they are, so a flow with a hop under
  // deletion can still be reordered. Only a hop the change newly puts in a
  // flow, in a new flow or an existing one, may not be one being deleted.
  const listedNow = new Set(
    change.action === "hops"
      ? Arr.flatMap(world.data.flows, (flow) =>
          flow.id === change.flow ? flow.hops : []
        )
      : []
  );

  const deleting = Option.map(
    Arr.findFirst(
      action.hops(),
      (hop) => removed.has(hop) && !listedNow.has(hop)
    ),
    (hop) =>
      `Hop "${hop}" is proposed for deletion, so a flow can't list it. Leave it out, or withdraw the deletion.`
  );

  const unknownFlow = Option.map(
    Arr.findFirst(
      action.flows(),
      (flow) => change.action !== "add" && !flows.has(flow)
    ),
    noFlow
  );

  if (change.action === "add" && flows.has(change.flow.id)) {
    return Option.some(
      `The map already has a flow with the id "${change.flow.id}".`
    );
  }

  return Option.orElse(
    Option.orElse(unknownFlow, () => unknownHop),
    () => deleting
  );
};

/** An open flow add changed by a rename or a new list of hops. */
const editedFlowAdd = (
  open: readonly FlowProposal[],
  change: FlowChange
): Option.Option<readonly FlowProposal[]> => {
  if (change.action === "add" || change.action === "reorder") {
    return Option.none();
  }

  const found = Arr.findFirst(
    open,
    ({ change: held }) => held.action === "add" && held.flow.id === change.flow
  );

  return Option.flatMap(found, (proposal) => {
    const { change: made } = proposal;

    if (made.action !== "add") {
      return Option.none();
    }

    const next: FlowChange =
      change.action === "rename"
        ? flowActionOf(made).withText(change.name)
        : { ...made, hops: change.hops };

    return Option.some(
      Arr.map(open, (other) =>
        other.id === proposal.id ? { ...other, change: next } : other
      )
    );
  });
};

/** What the propose engine needs to know about flow proposals on `world`. */
const flowKind = (
  world: ConnectionWorld,
  proposals: Proposals
): ProposalKind<FlowChange> => ({
  noun: "flow",
  open: flowsOpen,
  withOpen: (held, flows) => ({ ...held, revision: held.revision + 1, flows }),
  targetOf: flowOf,
  isAdd: (change) => change.action === "add",
  sameChange: sameFlowChange,
  sameSubject: sameFlowSubject,
  waitingAdds: (held) => addedFlowIds(frozenFlowChanges(held)),
  edited: editedFlowAdd,
  refusal: (change) => flowWorldRefusal(world, proposals, change),
  isCurrent: (change) => flowIsCurrent(world.base, change),
});

/**
 * Sets the open flow proposal `id` to `change`: how the page creates a flow,
 * renames one, sets its ordered hops or reorders the flows. The rules are
 * those of `proposeInto`. A change fails, and changes nothing, when it names
 * a flow or hop the map lacks, or lists a hop that is proposed for deletion.
 */
export const proposeFlow = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: FlowChange;
  readonly world: ConnectionWorld;
}): Result.Result<Proposals, string> =>
  proposeInto({ kind: flowKind(world, proposals), proposals, id, change });

/** A fresh provisional id for a flow called `name`, such as `checkout-4f2a`. */
export const newFlowId = (name: string): string =>
  provisionalIdOf(name, Str.slice(0, 4)(newChangeId()));

// ─── checks ────────────────────────────────────────────────────────────────

/**
 * Warnings about open hop and flow proposals that no longer fit `data`: an
 * add whose id data.mjs has taken, a change to a hop or flow data.mjs lost,
 * and a flow that lists a hop neither data.mjs nor a proposal has. `data` is
 * data.mjs as the agent left it, not the proposed map.
 */
export const checkConnectionProposals: {
  (proposals: Proposals): (data: MapData) => readonly MapProblem[];
  (data: MapData, proposals: Proposals): readonly MapProblem[];
} = dual(2, (data: MapData, proposals: Proposals): readonly MapProblem[] => {
  const hopIds = new Set(Arr.map(data.hops, ({ id }) => id));
  const flowIds = new Set(Arr.map(data.flows, ({ id }) => id));

  const proposedHops = new Set([
    ...addedHopIds(frozenHopChanges(proposals)),
    ...addedHopIds(openHopChanges(proposals)),
  ]);

  const proposedFlows = new Set([
    ...addedFlowIds(frozenFlowChanges(proposals)),
    ...addedFlowIds(openFlowChanges(proposals)),
  ]);

  const hopProblems = Arr.flatMap(hopsOpen(proposals), ({ change }, index) => {
    const id = hopOf(change);
    const path = ["hops", index, "change", "hop"];

    if (change.action === "add") {
      return hopIds.has(id)
        ? [
            mapWarning({
              file: "proposals.json",
              path: [...path, "id"],
              message: `data.mjs already has a hop with the id "${id}", which this proposal adds. Discard it from the page's Pending list.`,
            }),
          ]
        : [];
    }

    return hopIds.has(id) || proposedHops.has(id)
      ? []
      : [
          mapWarning({
            file: "proposals.json",
            path,
            message: `no hop in data.mjs has the id "${id}", so this ${change.action} does nothing. Discard it from the page's Pending list.`,
          }),
        ];
  });

  const flowProblems = Arr.flatMap(
    flowsOpen(proposals),
    ({ change }, index) => {
      const path = ["flows", index, "change"];

      const unknownHops =
        change.action === "add" || change.action === "hops"
          ? Arr.flatMap(change.hops, (hop) =>
              hopIds.has(hop) || proposedHops.has(hop)
                ? []
                : [
                    mapWarning({
                      file: "proposals.json",
                      path: [...path, "hops"],
                      message: `no hop in data.mjs has the id "${hop}", so this flow lists a hop that isn't there. Discard it from the page's Pending list.`,
                    }),
                  ]
            )
          : [];

      if (change.action === "add") {
        return flowIds.has(change.flow.id)
          ? [
              mapWarning({
                file: "proposals.json",
                path: [...path, "flow", "id"],
                message: `data.mjs already has a flow with the id "${change.flow.id}", which this proposal adds. Discard it from the page's Pending list.`,
              }),
              ...unknownHops,
            ]
          : unknownHops;
      }

      if (change.action === "reorder") {
        return Arr.flatMap(change.flows, (flow) =>
          flowIds.has(flow) || proposedFlows.has(flow)
            ? []
            : [
                mapWarning({
                  file: "proposals.json",
                  path: [...path, "flows"],
                  message: `no flow in data.mjs has the id "${flow}", so the order can't include it. Discard it from the page's Pending list.`,
                }),
              ]
        );
      }

      return flowIds.has(change.flow) || proposedFlows.has(change.flow)
        ? unknownHops
        : [
            mapWarning({
              file: "proposals.json",
              path,
              message: `no flow in data.mjs has the id "${change.flow}", so this ${change.action} does nothing. Discard it from the page's Pending list.`,
            }),
            ...unknownHops,
          ];
    }
  );

  return [...hopProblems, ...flowProblems];
});
