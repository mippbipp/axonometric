import {
  Array as Arr,
  Match,
  Option,
  Predicate,
  Record as Rec,
  Result,
  Schema,
} from "effect";

import { Placement, RouteOverride } from "./layout.ts";
import type { GridPoint, Layout } from "./layout.ts";
import {
  applyLayoutChanges,
  hopsOf,
  LayoutChange,
  placeRoute,
  placeStructure,
  structuresOf,
} from "./proposals.ts";
import type { Author, ChangeId, Reason, Target } from "./proposals.ts";

// The rules for agent changes beside the engineer's. No target, a structure
// or a hop, is held by both an agent change and an engineer change, open or
// frozen in a batch. The CLI, the page and the server all keep to it here.

const sameChange = Schema.toEquivalence(LayoutChange);

const samePlacement = Schema.toEquivalence(Placement);

const sameRoute = Schema.toEquivalence(Schema.NullOr(RouteOverride));

const targetsOf = (change: LayoutChange): ReadonlyArray<Target> => [
  ...Arr.map(structuresOf(change), (id): Target => ({ id, kind: "structure" })),
  ...Arr.map(hopsOf(change), (id): Target => ({ id, kind: "hop" })),
];

const sameTarget = (a: Target, b: Target) => a.kind === b.kind && a.id === b.id;

const actsOn = (change: LayoutChange, target: Target) =>
  Arr.some(targetsOf(change), (on) => sameTarget(on, target));

const byAgent = (change: LayoutChange) => change.by === "agent";

/** Why the agent can't act on `target`: the first change in `engineer` that acts on it. */
const heldRefusal = (
  target: Target,
  engineer: ReadonlyArray<LayoutChange>
): Option.Option<string> =>
  Option.map(
    Arr.findFirst(engineer, (change) => actsOn(change, target)),
    (held) =>
      target.kind === "structure"
        ? `The engineer has a pending ${held.kind} of "${target.id}" (change ${held.id}). Propose changes to other structures, or wait until they accept or discard change ${held.id}.`
        : `The engineer has a pending reroute of hop "${target.id}" (change ${held.id}). Propose changes to other hops, or wait until they accept or discard change ${held.id}.`
  );

/**
 * Why the changes in `agent` can't be laid beside those in `engineer`: the
 * first target both act on, naming the engineer's change. Nothing when they
 * share no target.
 */
export const agentTargetRefusal = ({
  agent,
  engineer,
}: {
  readonly agent: ReadonlyArray<LayoutChange>;
  readonly engineer: ReadonlyArray<LayoutChange>;
}): Option.Option<string> =>
  Arr.findFirst(Arr.flatMap(agent, targetsOf), (target) =>
    heldRefusal(target, engineer)
  );

/**
 * Why the page's write of `after` over `before` is refused for leaving an
 * engineer change it made or changed on a target an agent change holds. A
 * page that lets the engineer take over first never sends one.
 */
export const agentHeldWriteRefusal = ({
  after,
  before,
}: {
  readonly after: ReadonlyArray<LayoutChange>;
  readonly before: ReadonlyArray<LayoutChange>;
}): Option.Option<string> =>
  agentTargetRefusal({
    agent: Arr.filter(after, byAgent),
    engineer: Arr.filter(
      after,
      (change) =>
        change.by === "engineer" &&
        !Arr.some(before, (held) => sameChange(held, change))
    ),
  });

/** What the agent proposes for one target. */
export type AgentProposal =
  /** Puts a structure at `next`. */
  | {
      readonly _tag: "Place";
      readonly next: Placement;
      readonly structure: string;
    }
  /** Gives a hop the route override `points`, or puts it back on automatic with `null`. */
  | {
      readonly _tag: "Reroute";
      readonly hop: string;
      readonly points: ReadonlyArray<GridPoint> | null;
    };

const targetOfProposal = (proposal: AgentProposal): Target =>
  Match.valueTags(proposal, {
    Place: ({ structure }): Target => ({ id: structure, kind: "structure" }),
    Reroute: ({ hop }): Target => ({ id: hop, kind: "hop" }),
  });

/**
 * `changes` without the agent's parts on `targets`. An agent move of several
 * structures loses only the members on them, and goes once it has none.
 */
const withoutAgentOn = (
  changes: ReadonlyArray<LayoutChange>,
  targets: ReadonlyArray<Target>
): ReadonlyArray<LayoutChange> =>
  Arr.flatMap(changes, (change): ReadonlyArray<LayoutChange> => {
    if (!byAgent(change)) {
      return [change];
    }

    if (change.kind === "move") {
      const kept = Arr.filter(
        change.moves,
        ({ target }) => !Arr.some(targets, (on) => sameTarget(on, target))
      );

      if (kept.length === change.moves.length) {
        return [change];
      }

      return Arr.isReadonlyArrayNonEmpty(kept)
        ? [{ ...change, moves: kept }]
        : [];
    }

    return Arr.some(targets, (target) => actsOn(change, target))
      ? []
      : [change];
  });

/**
 * The pending list after the agent proposes `proposal` for `reason`. It is
 * refused when the engineer holds the target, open in `changes` or in
 * `frozen`, and when the structure has no placement in `base`. Otherwise
 * every agent change on the target is dropped, and the new value is laid as
 * the agent's, relative to `base` and the rest of the list. A proposal equal
 * to what the list already shows, for the reason the agent already gave,
 * returns the list unchanged.
 */
export const proposeAgentChange = ({
  base,
  changes,
  frozen,
  newId,
  proposal,
  reason,
}: {
  /** The layout open changes land on: accepted, with frozen items and proposed structures. */
  readonly base: Layout;
  /** The open layout changes. */
  readonly changes: ReadonlyArray<LayoutChange>;
  /** The layout changes frozen in batches that wait for the agent. */
  readonly frozen: ReadonlyArray<LayoutChange>;
  readonly newId: () => ChangeId;
  readonly proposal: AgentProposal;
  readonly reason: Reason;
}): Result.Result<ReadonlyArray<LayoutChange>, string> => {
  const target = targetOfProposal(proposal);

  const held = heldRefusal(target, [
    ...Arr.filter(changes, (change) => change.by === "engineer"),
    ...frozen,
  ]);

  if (Option.isSome(held)) {
    return Result.fail(held.value);
  }

  const shown = applyLayoutChanges(base, changes);
  const author: Author = { by: "agent", reason };
  const others = withoutAgentOn(changes, [target]);

  // A proposal the map already shows changes nothing, unless it gives the
  // agent's change on the target a new reason.
  const sameReason = Arr.every(
    changes,
    (change) =>
      !byAgent(change) || !actsOn(change, target) || change.reason === reason
  );

  return Match.valueTags(proposal, {
    Place: ({ next, structure }) =>
      Option.match(Rec.get(shown.structures, structure), {
        onNone: () =>
          Result.fail(
            `"${structure}" has no position yet, so there is nothing to propose a change to. Place it first with layout without --propose, or run axonometric build.`
          ),
        onSome: (placement) =>
          Result.succeed(
            sameReason && samePlacement(placement, next)
              ? changes
              : placeStructure({
                  accepted: base,
                  author,
                  changes: others,
                  id: structure,
                  newId,
                  next,
                })
          ),
      }),
    Reroute: ({ hop, points }) =>
      Result.succeed(
        sameReason && sameRoute(shown.routes?.[hop] ?? null, points)
          ? changes
          : placeRoute({
              accepted: base,
              author,
              changes: others,
              hop,
              newId,
              points,
            })
      ),
  });
};

/** `changes` with `target` laid back, as the engineer's, where `shown` has it. */
const layShown = ({
  base,
  changes,
  newId,
  shown,
  target,
}: {
  readonly base: Layout;
  readonly changes: ReadonlyArray<LayoutChange>;
  readonly newId: () => ChangeId;
  readonly shown: Layout;
  readonly target: Target;
}): ReadonlyArray<LayoutChange> =>
  target.kind === "structure"
    ? Option.match(Rec.get(shown.structures, target.id), {
        onNone: () => changes,
        onSome: (next) =>
          placeStructure({
            accepted: base,
            changes,
            id: target.id,
            newId,
            next,
          }),
      })
    : placeRoute({
        accepted: base,
        changes,
        hop: target.id,
        newId,
        points: shown.routes?.[target.id] ?? null,
      });

/**
 * The engineer's edit takes over the agent's changes on the targets it acts
 * on. `after` is the list an engineer edit made from `before`. For each
 * target that an engineer change in `after`, new or different from
 * `before`, acts on, and that an agent change also acts on: what `after`
 * shows for the target is kept, the agent's parts on it are removed, and the
 * shown value is laid back as the engineer's. So nothing jumps, and the
 * agent's change on the target is gone. A change the engineer adds gets an
 * id from `newId`, never the agent's. With no agent change in `after`, it
 * returns `after` as it is.
 *
 * `newId` must give the same ids each time the edit runs, so a rerun on a
 * fresher list gives the same answer.
 */
export const engineerTakesOver = ({
  after,
  base,
  before,
  newId,
}: {
  readonly after: ReadonlyArray<LayoutChange>;
  readonly base: Layout;
  readonly before: ReadonlyArray<LayoutChange>;
  readonly newId: () => ChangeId;
}): ReadonlyArray<LayoutChange> => {
  const agentTargets = Arr.flatMap(Arr.filter(after, byAgent), targetsOf);

  if (agentTargets.length === 0) {
    return after;
  }

  const made = Arr.filter(
    after,
    (change) =>
      change.by === "engineer" &&
      !Arr.some(before, (held) => sameChange(held, change))
  );

  const taken = Arr.dedupeWith(
    Arr.filter(Arr.flatMap(made, targetsOf), (target) =>
      Arr.some(agentTargets, (held) => sameTarget(held, target))
    ),
    sameTarget
  );

  if (taken.length === 0) {
    return after;
  }

  const shown = applyLayoutChanges(base, after);

  return Arr.reduce(taken, withoutAgentOn(after, taken), (changes, target) =>
    layShown({ base, changes, newId, shown, target })
  );
};

/**
 * A row of the Pending tab: an engineer change, or a run of consecutive
 * agent changes with the same reason. A run of one is a group of one.
 */
export type PendingRow =
  | { readonly _tag: "Change"; readonly change: LayoutChange }
  | {
      readonly _tag: "AgentGroup";
      readonly changes: Arr.NonEmptyReadonlyArray<LayoutChange>;
      readonly reason: string | undefined;
    };

/** The rows the Pending tab lists `changes` in, in list order. */
export const pendingRows = (
  changes: ReadonlyArray<LayoutChange>
): ReadonlyArray<PendingRow> =>
  Arr.reduce(changes, [] as ReadonlyArray<PendingRow>, (rows, change) => {
    if (!byAgent(change)) {
      return [...rows, { _tag: "Change", change }];
    }

    const last = rows.at(-1);

    return Predicate.isTagged(last, "AgentGroup") &&
      last.reason === change.reason
      ? [
          ...rows.slice(0, -1),
          { ...last, changes: Arr.append(last.changes, change) },
        ]
      : [
          ...rows,
          { _tag: "AgentGroup", changes: [change], reason: change.reason },
        ];
  });
