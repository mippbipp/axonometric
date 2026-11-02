import { Array as Arr, Option, Result, Schema, String as Str } from "effect";
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
import {
  flowOf,
  FlowChange,
  sameFlowChange,
  sameFlowSubject,
} from "./flow-change.ts";
import { flowIsCurrent } from "./flow-effects.ts";
import {
  HopChange,
  hopOf,
  sameHopChange,
  sameHopSubject,
} from "./hop-change.ts";
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
import { frozenRefusal, reviewEntries } from "./review.ts";
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

/** Whether `id` is already used by an item of any kind, open or in a batch. */
const idTaken = (proposals: Proposals, id: string) =>
  Arr.some(reviewEntries(proposals), ({ item }) => item.id === id);

const taken = (id: string) => `The id "${id}" is already in use.`;

/**
 * Why `id` can't be used for a proposal: a frozen item has it, or another
 * proposal does. An open proposal of the same subject may be set again under
 * its own id, which `same` tells.
 */
const idRefusal = ({
  proposals,
  id,
  same,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  /** Whether the open hop or flow proposal holding `id` is the one being set. */
  readonly same: (held: HopProposal | FlowProposal) => boolean;
}): Option.Option<string> => {
  const held = Arr.findFirst(
    [...hopsOpen(proposals), ...flowsOpen(proposals)],
    (proposal) => proposal.id === id
  );

  if (Option.isSome(held)) {
    return same(held.value) ? Option.none() : Option.some(taken(id));
  }

  return Option.orElse(frozenRefusal(proposals, id), () =>
    idTaken(proposals, id) ? Option.some(taken(id)) : Option.none()
  );
};

const isHopChange = Schema.is(HopChange);

const isFlowChange = Schema.is(FlowChange);

const bumpHops = (
  proposals: Proposals,
  hops: readonly HopProposal[]
): Proposals => ({ ...proposals, revision: proposals.revision + 1, hops });

const bumpFlows = (
  proposals: Proposals,
  flows: readonly FlowProposal[]
): Proposals => ({ ...proposals, revision: proposals.revision + 1, flows });

const noHop = (id: string) =>
  `No hop in the map has the id "${id}", so there is nothing to change.`;

const noFlow = (id: string) =>
  `No flow in the map has the id "${id}", so there is nothing to change.`;

/** The hop ids the map has, proposed ones included. */
const hopIdsIn = (world: ConnectionWorld) =>
  new Set(Arr.map(world.data.hops, ({ id }) => id));

const flowIdsIn = (world: ConnectionWorld) =>
  new Set(Arr.map(world.data.flows, ({ id }) => id));

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
              ? {
                  ...other,
                  change: {
                    ...made,
                    hop: { ...made.hop, label: change.label },
                  },
                }
              : other
          )
        )
      : Option.none();
  });
};

/**
 * Sets the open hop proposal `id` to `change`: how the page draws a hop,
 * deletes or relabels one.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing.
 * - A relabel or delete of a hop that is only proposed edits that proposal,
 *   or takes it away; flows that listed the hop lose it.
 * - One open proposal is kept per hop and action. A change that leaves the
 *   label as the map has it takes the proposal away.
 * - Fails, and changes nothing, when `id` is in a batch, the hop is a new
 *   one waiting in a batch, or the change would not fit: a hop the map
 *   lacks, an end it lacks, or the same structure at both ends.
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
  const open = hopsOpen(proposals);

  const refused = idRefusal({
    proposals,
    id,
    same: ({ change: held }) =>
      isHopChange(held) && sameHopSubject(held, change),
  });

  if (Option.isSome(refused)) {
    return Result.fail(refused.value);
  }

  // The same write sent again, such as after a lost answer.
  const sent = Arr.findFirst(open, (proposal) => proposal.id === id);

  if (Option.exists(sent, (held) => sameHopChange(held.change, change))) {
    return Result.succeed(proposals);
  }

  const target = hopOf(change);
  const waiting = addedHopIds(frozenHopChanges(proposals));

  if (Arr.some(waiting, (other) => other === target)) {
    return Result.fail(
      `"${target}" is a new hop in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
    );
  }

  if (
    change.action === "add" &&
    Arr.some(
      open,
      (other) =>
        other.id !== id &&
        other.change.action === "add" &&
        other.change.hop.id === target
    )
  ) {
    return Result.fail(
      `Another proposal already adds a hop with the id "${target}".`
    );
  }

  const edited =
    change.action === "add" ? Option.none() : editedHopAdd(open, change);

  if (Option.isSome(edited)) {
    const next = bumpHops(proposals, edited.value);

    return Result.succeed(
      change.action === "delete" ? withoutOpenHop(next, target) : next
    );
  }

  const unfit = hopWorldRefusal(world, change);

  if (Option.isSome(unfit)) {
    return Result.fail(unfit.value);
  }

  const twin = Arr.findFirst(
    open,
    (proposal) =>
      proposal.change.action !== "add" &&
      sameHopSubject(proposal.change, change)
  );

  const keptId = Option.match(twin, { onNone: () => id, onSome: (t) => t.id });

  if (change.action !== "add" && hopIsCurrent(world.base, change)) {
    return Result.succeed(
      Option.isNone(twin)
        ? proposals
        : bumpHops(
            proposals,
            Arr.filter(open, (proposal) => proposal.id !== keptId)
          )
    );
  }

  const existing = Arr.findFirst(open, (proposal) => proposal.id === keptId);

  if (Option.isSome(existing) && sameHopChange(existing.value.change, change)) {
    return Result.succeed(proposals);
  }

  return Result.succeed(
    bumpHops(
      proposals,
      Option.isSome(existing)
        ? Arr.map(open, (proposal) =>
            proposal.id === keptId ? { id: keptId, change } : proposal
          )
        : [...open, { id: keptId, change }]
    )
  );
};

/** A fresh provisional id for a hop called `label`, such as `reads-config-4f2a`. */
export const newHopId = (label: string): string =>
  provisionalIdOf(label, Str.slice(0, 4)(newChangeId()));

// ─── flows ─────────────────────────────────────────────────────────────────

/** Why `change` can't be proposed against `world`, or nothing. */
const flowWorldRefusal = (
  world: ConnectionWorld,
  change: FlowChange
): Option.Option<string> => {
  const hops = hopIdsIn(world);
  const flows = flowIdsIn(world);

  const unknownHop = (ids: readonly string[]) =>
    Option.map(
      Arr.findFirst(ids, (hop) => !hops.has(hop)),
      noHop
    );

  if (change.action === "add") {
    return flows.has(change.flow.id)
      ? Option.some(
          `The map already has a flow with the id "${change.flow.id}".`
        )
      : unknownHop(change.hops);
  }

  if (change.action === "reorder") {
    return Option.map(
      Arr.findFirst(change.flows, (flow) => !flows.has(flow)),
      noFlow
    );
  }

  return flows.has(change.flow)
    ? change.action === "hops"
      ? unknownHop(change.hops)
      : Option.none()
    : Option.some(noFlow(change.flow));
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
        ? { ...made, flow: { ...made.flow, name: change.name } }
        : { ...made, hops: change.hops };

    return Option.some(
      Arr.map(open, (other) =>
        other.id === proposal.id ? { ...other, change: next } : other
      )
    );
  });
};

/**
 * Sets the open flow proposal `id` to `change`: how the page creates a flow,
 * renames one, sets its ordered hops or reorders the flows.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing.
 * - A rename or new hops of a flow that is only proposed edits that
 *   proposal.
 * - One open proposal is kept per flow and action, and one reorder. A change
 *   that leaves the map as it is takes the proposal away.
 * - Fails, and changes nothing, when `id` is in a batch, the flow is a new
 *   one waiting in a batch, or the change would not fit: a flow or hop the
 *   map lacks.
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
}): Result.Result<Proposals, string> => {
  const open = flowsOpen(proposals);

  const refused = idRefusal({
    proposals,
    id,
    same: ({ change: held }) =>
      isFlowChange(held) && sameFlowSubject(held, change),
  });

  if (Option.isSome(refused)) {
    return Result.fail(refused.value);
  }

  // The same write sent again, such as after a lost answer.
  const sent = Arr.findFirst(open, (proposal) => proposal.id === id);

  if (Option.exists(sent, (held) => sameFlowChange(held.change, change))) {
    return Result.succeed(proposals);
  }

  const target = flowOf(change);
  const waiting = addedFlowIds(frozenFlowChanges(proposals));

  if (target !== "" && Arr.some(waiting, (other) => other === target)) {
    return Result.fail(
      `"${target}" is a new flow in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
    );
  }

  if (
    change.action === "add" &&
    Arr.some(
      open,
      (other) =>
        other.id !== id &&
        other.change.action === "add" &&
        other.change.flow.id === target
    )
  ) {
    return Result.fail(
      `Another proposal already adds a flow with the id "${target}".`
    );
  }

  const edited = editedFlowAdd(open, change);

  if (Option.isSome(edited)) {
    return Result.succeed(bumpFlows(proposals, edited.value));
  }

  const unfit = flowWorldRefusal(world, change);

  if (Option.isSome(unfit)) {
    return Result.fail(unfit.value);
  }

  const twin = Arr.findFirst(
    open,
    (proposal) =>
      proposal.change.action !== "add" &&
      sameFlowSubject(proposal.change, change)
  );

  const keptId = Option.match(twin, { onNone: () => id, onSome: (t) => t.id });

  if (change.action !== "add" && flowIsCurrent(world.base, change)) {
    return Result.succeed(
      Option.isNone(twin)
        ? proposals
        : bumpFlows(
            proposals,
            Arr.filter(open, (proposal) => proposal.id !== keptId)
          )
    );
  }

  const existing = Arr.findFirst(open, (proposal) => proposal.id === keptId);

  if (
    Option.isSome(existing) &&
    sameFlowChange(existing.value.change, change)
  ) {
    return Result.succeed(proposals);
  }

  return Result.succeed(
    bumpFlows(
      proposals,
      Option.isSome(existing)
        ? Arr.map(open, (proposal) =>
            proposal.id === keptId ? { id: keptId, change } : proposal
          )
        : [...open, { id: keptId, change }]
    )
  );
};

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
