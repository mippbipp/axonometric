import {
  applyLayoutChanges,
  defaultFootprint,
  footprintsOverlap,
  formatProblem,
  frozenLayoutChanges,
  frozenWriteRefusal,
  layoutAfterChanges,
  layoutRefusal,
  layoutUnderProposals,
  maxReasonLength,
  newChangeId,
  onOutline,
  proposeAgentChange,
  sameLayoutChanges,
} from "@axonometric/contracts";
import type {
  AgentProposal,
  GridPoint,
  Hop,
  Layout,
  MapData,
  Placement,
  Reason,
} from "@axonometric/contracts";
import {
  Array as Arr,
  Console,
  Effect,
  Match,
  Option,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import { homePaths } from "./home-paths.ts";
import { withLock } from "./lock.ts";
import {
  encodeLayout,
  encodeProposals,
  inspectMap,
  loadMap,
} from "./map-files.ts";
import { writeAll } from "./write-files.ts";

/** A `layout` request the map can't take. `layout` wrote nothing. */
export class LayoutRejected extends Schema.TaggedError<
  LayoutRejected,
  { readonly brand: unique symbol }
>()("LayoutRejected", { reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `${this.reason} layout wrote nothing.`;
  }
}

const fields = ["x", "y", "w", "d"] as const;

type Field = (typeof fields)[number];

type Changes = Readonly<Record<Field, Option.Option<number>>>;

const onHalfUnit = (value: number) => Number.isInteger(value * 2);

const describePlacement = ({ d, w, x, y }: Placement) =>
  `x ${x}, y ${y}, w ${w}, d ${d}`;

/** Every problem with the values given, before the map is read. */
const invalidValues = (changes: Changes): ReadonlyArray<string> =>
  Arr.flatMap(fields, (field) =>
    Option.match(changes[field], {
      onNone: () => [],
      onSome: (value) => {
        if (!onHalfUnit(value)) {
          return [
            `--${field} ${value} isn't on the half-unit grid. Use a whole or half unit, such as ${Math.floor(value)} or ${Math.floor(value) + 0.5}.`,
          ];
        }

        return (field === "w" || field === "d") && value <= 0
          ? [
              `--${field} ${value} is too small. A footprint is at least half a unit, so use 0.5 or more.`,
            ]
          : [];
      },
    })
  );

/** What changed between two placements, such as `x 4 → 8, y 0 → 0.5`. */
const describeChanges = (before: Placement, after: Placement) =>
  Arr.join(
    Arr.flatMap(fields, (field) =>
      before[field] === after[field]
        ? []
        : [`${field} ${before[field]} → ${after[field]}`]
    ),
    ", "
  );

const reject = (reason: string) => Effect.fail(LayoutRejected.make({ reason }));

/** Why the values given can't move or resize a structure, before the map is read. */
const valuesProblem = (changes: Changes): Option.Option<string> => {
  if (Arr.every(fields, (field) => Option.isNone(changes[field]))) {
    return Option.some(
      `Say what to change. Give at least one of --x, --y, --w and --d.`
    );
  }

  const problems = invalidValues(changes);

  return problems.length > 0
    ? Option.some(Arr.join(problems, " "))
    : Option.none();
};

/** The placement `changes` make of `before`: the fields given replace its own. */
const placedFrom = (before: Placement, changes: Changes): Placement => ({
  d: Option.getOrElse(changes.d, () => before.d),
  w: Option.getOrElse(changes.w, () => before.w),
  x: Option.getOrElse(changes.x, () => before.x),
  y: Option.getOrElse(changes.y, () => before.y),
});

const unknownStructure = (id: string, ids: ReadonlyArray<string>) =>
  `No structure in data.mjs has the id "${id}". Use one of: ${Arr.join(ids, ", ")}.`;

const unknownHop = (id: string, hops: ReadonlyArray<Hop>) =>
  `No hop in data.mjs has the id "${id}". Use one of: ${Arr.join(
    Arr.map(hops, (hop) => hop.id),
    ", "
  )}.`;

const routeExample = `"4,2 4,6 9,6"`;

/** The points of `--route "x,y x,y ..."`, or why the text isn't that. */
const parseRoute = (
  text: string
): Result.Result<ReadonlyArray<GridPoint>, string> => {
  const words = Arr.filter(
    Str.split(Str.trim(text), /\s+/u),
    (word) => word !== ""
  );

  const points = Arr.map(words, (word) => {
    const [x, y, ...rest] = Str.split(word, ",");
    const point = { x: Number(x), y: Number(y) };

    return x === undefined ||
      y === undefined ||
      rest.length > 0 ||
      Str.isEmpty(Str.trim(x)) ||
      Str.isEmpty(Str.trim(y)) ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
      ? Result.fail(word)
      : Result.succeed(point);
  });

  const bad = Arr.findFirst(points, Result.isFailure);

  if (Option.isSome(bad) && Result.isFailure(bad.value)) {
    return Result.fail(
      `--route point "${bad.value.failure}" isn't x,y. Write each point as two numbers joined by a comma, and separate points with spaces, such as ${routeExample}.`
    );
  }

  return Result.succeed(Arr.getSuccesses(points));
};

/** The route `--route` asks for: grid points, or `null` for auto. */
const routeOf = (
  text: string
): Result.Result<ReadonlyArray<GridPoint> | null, string> =>
  Str.trim(text) === "auto" ? Result.succeed(null) : parseRoute(text);

const describeRoute = (points: ReadonlyArray<GridPoint>) =>
  Arr.join(
    Arr.map(points, ({ x, y }) => `${x},${y}`),
    " "
  );

/** Why a route can't be a hop's override, or nothing when it can. */
const routeProblem = (
  route: ReadonlyArray<GridPoint>,
  hop: { readonly from: string; readonly id: string; readonly to: string },
  structures: Layout["structures"]
): Option.Option<string> => {
  const off = Arr.findFirst(
    route,
    ({ x, y }) => !onHalfUnit(x) || !onHalfUnit(y)
  );

  if (Option.isSome(off)) {
    return Option.some(
      `--route point ${off.value.x},${off.value.y} isn't on the half-unit grid. Use whole or half units, such as 4 or 4.5.`
    );
  }

  if (route.length < 2) {
    return Option.some(
      `--route needs at least two points, from one footprint's edge to the other's, such as ${routeExample}.`
    );
  }

  const diagonal = Arr.findFirst(
    Arr.zip(route, Arr.drop(route, 1)),
    ([from, to]) => from.x !== to.x && from.y !== to.y
  );

  if (Option.isSome(diagonal)) {
    const [from, to] = diagonal.value;

    return Option.some(
      `--route runs diagonally from ${from.x},${from.y} to ${to.x},${to.y}. Every leg must run along x or y, so add a corner point that shares x with one and y with the other, such as ${from.x},${to.y}.`
    );
  }

  const [first] = route;
  const last = route.at(-1);
  const from = structures[hop.from];
  const to = structures[hop.to];

  if (from === undefined || to === undefined) {
    return Option.some(
      `Hop "${hop.id}" has an end the layout doesn't place, so it can't be rerouted. Place "${from === undefined ? hop.from : hop.to}" first, or run axonometric build.`
    );
  }

  if (first !== undefined && !onOutline(first, from)) {
    return Option.some(
      `--route starts at ${first.x},${first.y}, which isn't on the edge of "${hop.from}" at x ${from.x}–${from.x + from.w}, y ${from.y}–${from.y + from.d}. Start on that footprint's edge.`
    );
  }

  return last !== undefined && !onOutline(last, to)
    ? Option.some(
        `--route ends at ${last.x},${last.y}, which isn't on the edge of "${hop.to}" at x ${to.x}–${to.x + to.w}, y ${to.y}–${to.y + to.d}. End on that footprint's edge.`
      )
    : Option.none();
};

const reroute = Effect.fn("reroute")(function* (
  home: string,
  hopId: string,
  routeText: string
) {
  const paths = yield* homePaths(home);
  const route = routeOf(routeText);

  if (Result.isFailure(route)) {
    return yield* reject(route.failure);
  }

  yield* withLock(paths, "layout");

  const map = yield* loadMap({
    command: "layout",
    drawingWarnings: true,
    paths,
  });

  const hop = Arr.findFirst(map.data.hops, ({ id }) => id === hopId);

  if (Option.isNone(hop)) {
    return yield* reject(unknownHop(hopId, map.data.hops));
  }

  const current = map.saved.routes?.[hopId];
  const points = route.success;

  if (points === null && current === undefined) {
    return yield* Console.log(
      `${hopId}: already routes itself. Nothing changed.`
    );
  }

  if (points !== null) {
    const problem = routeProblem(points, hop.value, map.saved.structures);

    if (Option.isSome(problem)) {
      return yield* reject(problem.value);
    }

    if (
      current !== undefined &&
      current.length === points.length &&
      Arr.every(
        current,
        (point, index) =>
          point.x === points[index]?.x && point.y === points[index]?.y
      )
    ) {
      return yield* Console.log(
        `${hopId}: route already saved. Nothing changed.`
      );
    }
  }

  const revision = map.saved.revision + 1;
  const { routes: _, ...rest } = map.saved;
  const others = Rec.remove(map.saved.routes ?? {}, hopId);
  const routes = points === null ? others : { ...others, [hopId]: points };

  const next: Layout =
    Rec.size(routes) === 0
      ? { ...rest, revision }
      : { ...rest, revision, routes };

  yield* writeAll([
    {
      content: yield* encodeLayout(next),
      file: paths.layoutFile,
    },
  ]);

  yield* Effect.forEach(
    map.warnings,
    (warning) => Console.error(formatProblem(warning)),
    { concurrency: 1, discard: true }
  );

  return yield* Console.log(
    points === null
      ? `${hopId}: route override cleared, so the hop routes itself. layout.json is at revision ${revision}.`
      : `${hopId}: route saved through ${describeRoute(points)}. layout.json is at revision ${revision}.`
  );
}, Effect.scoped);

const layout = Effect.fn("layout")(function* (
  home: string,
  id: string,
  changes: Changes
) {
  const paths = yield* homePaths(home);
  const problem = valuesProblem(changes);

  if (Option.isSome(problem)) {
    return yield* reject(problem.value);
  }

  yield* withLock(paths, "layout");

  const map = yield* loadMap({
    command: "layout",
    drawingWarnings: true,
    paths,
  });

  const ids = Arr.map(map.data.structures, (structure) => structure.id);

  if (!ids.includes(id)) {
    return yield* reject(unknownStructure(id, ids));
  }

  const before = Option.fromNullishOr(map.saved.structures[id]);

  if (
    Option.isNone(before) &&
    (Option.isNone(changes.x) || Option.isNone(changes.y))
  ) {
    return yield* reject(
      `"${id}" has no position yet. Give both --x and --y to place it, or run axonometric build to place it automatically.`
    );
  }

  const base = Option.getOrElse(before, () => ({
    x: 0,
    y: 0,
    ...defaultFootprint,
  }));

  const after = placedFrom(base, changes);

  const clash = Arr.findFirst(
    Rec.toEntries(map.saved.structures),
    ([other, placement]) => other !== id && footprintsOverlap(after, placement)
  );

  if (Option.isSome(clash)) {
    const [other, placement] = clash.value;

    return yield* reject(
      `${id} at ${describePlacement(after)} would overlap "${other}" at ${describePlacement(placement)}. Pick a free spot.`
    );
  }

  if (Option.isSome(before) && describeChanges(before.value, after) === "") {
    return yield* Console.log(
      `${id}: already at ${describePlacement(after)}. Nothing changed.`
    );
  }

  const revision = map.saved.revision + 1;

  const next = {
    ...map.saved,
    revision,
    structures: { ...map.saved.structures, [id]: after },
  };

  yield* writeAll([
    {
      content: yield* encodeLayout(next),
      file: paths.layoutFile,
    },
  ]);

  const change = Option.match(before, {
    onNone: () => `placed at ${describePlacement(after)}`,
    onSome: (placement) => describeChanges(placement, after),
  });

  yield* Effect.forEach(
    map.warnings,
    (warning) => Console.error(formatProblem(warning)),
    { concurrency: 1, discard: true }
  );

  return yield* Console.log(
    `${id}: ${change}. layout.json is at revision ${revision}.`
  );
}, Effect.scoped);

/** What `--propose` asks for, read from the arguments before the map is. */
type Ask =
  | {
      readonly _tag: "Place";
      readonly changes: Changes;
      readonly structure: string;
    }
  | {
      readonly _tag: "Reroute";
      readonly hop: string;
      readonly points: ReadonlyArray<GridPoint> | null;
    };

/** A proposal for the map, and what it changes, for the line `layout` prints. */
interface Asked {
  readonly id: string;
  readonly proposal: AgentProposal;
  readonly what: string;
}

/**
 * The proposal `ask` makes of the map as the page shows it, `shown`, or why
 * it can't make one. The fields given replace the ones shown.
 */
const proposalOf = (
  ask: Ask,
  { data, shown }: { readonly data: MapData; readonly shown: Layout }
): Result.Result<Asked, string> =>
  Match.valueTags(ask, {
    Place: ({ changes, structure }) => {
      const ids = Arr.map(data.structures, ({ id }) => id);

      if (!ids.includes(structure)) {
        return Result.fail(unknownStructure(structure, ids));
      }

      return Option.match(Rec.get(shown.structures, structure), {
        onNone: () =>
          Result.fail(
            `"${structure}" has no position yet, so there is nothing to propose a change to. Place it with layout without --propose, or run axonometric build.`
          ),
        onSome: (before) => {
          const next = placedFrom(before, changes);

          return Result.succeed<Asked>({
            id: structure,
            proposal: { _tag: "Place", next, structure },
            what: describeChanges(before, next),
          });
        },
      });
    },
    Reroute: ({ hop: hopId, points }) =>
      Option.match(
        Arr.findFirst(data.hops, ({ id }) => id === hopId),
        {
          onNone: () => Result.fail(unknownHop(hopId, data.hops)),
          onSome: (hop) => {
            const problem =
              points === null
                ? Option.none()
                : routeProblem(points, hop, shown.structures);

            return Option.match(problem, {
              onNone: () =>
                Result.succeed<Asked>({
                  id: hopId,
                  proposal: { _tag: "Reroute", hop: hopId, points },
                  what:
                    points === null
                      ? "automatic routing"
                      : `route through ${describeRoute(points)}`,
                }),
              onSome: Result.fail,
            });
          },
        }
      ),
  });

/**
 * Proposes `ask` to the engineer as the agent's pending layout change, for
 * `reason`, in proposals.json under the map's lock. layout.json is never
 * written: the change waits until the engineer accepts it.
 */
const propose = Effect.fn("propose")(function* (
  home: string,
  ask: Ask,
  reason: Reason
) {
  const paths = yield* homePaths(home);

  yield* withLock(paths, "layout");

  const map = yield* loadMap({ command: "layout", paths });
  const { proposals } = map;

  const base = layoutUnderProposals({
    data: map.data,
    layout: map.saved,
    proposals,
  });

  const asked = proposalOf(ask, {
    data: map.data,
    shown: applyLayoutChanges(base, proposals.layout),
  });

  if (Result.isFailure(asked)) {
    return yield* reject(asked.failure);
  }

  const { id, proposal, what } = asked.success;

  const proposed = proposeAgentChange({
    base,
    changes: proposals.layout,
    frozen: frozenLayoutChanges(proposals),
    newId: newChangeId,
    proposal,
    reason,
  });

  if (Result.isFailure(proposed)) {
    return yield* reject(proposed.failure);
  }

  const after = proposed.success;

  // The page refuses the same lists, so the agent can't propose one the
  // engineer couldn't make.
  const refusal = Option.orElse(frozenWriteRefusal({ after, proposals }), () =>
    layoutRefusal({
      accepted: base,
      after,
      before: proposals.layout,
      hops: map.data.hops,
    })
  );

  if (Option.isSome(refusal)) {
    return yield* reject(refusal.value);
  }

  if (sameLayoutChanges(after, proposals.layout)) {
    return yield* Console.log(
      `${id}: the map already shows that. Nothing changed.`
    );
  }

  const revision = proposals.revision + 1;

  yield* writeAll([
    {
      content: yield* encodeProposals({
        ...proposals,
        layout: after,
        revision,
      }),
      file: paths.proposalsFile,
    },
  ]);

  const { problems } = yield* inspectMap(paths, {
    arrange: (data, saved) =>
      layoutAfterChanges({ changes: after, hops: data.hops, layout: saved }),
    drawingWarnings: true,
  });

  yield* Effect.forEach(
    problems,
    (problem) => Console.error(formatProblem(problem)),
    { concurrency: 1, discard: true }
  );

  return yield* Console.log(
    `${id}: proposed ${Str.isEmpty(what) ? "as before" : what}, for "${reason}". proposals.json is at revision ${revision}. The engineer accepts or discards it in the Pending tab.`
  );
}, Effect.scoped);

/**
 * The reason `--propose --reason` gives, nothing without `--propose`, or why
 * the pair can't go together.
 */
const reasonOf = (
  proposing: boolean,
  given: Option.Option<string>
): Result.Result<Option.Option<Reason>, string> => {
  if (!proposing) {
    return Option.isSome(given)
      ? Result.fail(
          `--reason goes with --propose. Add --propose to leave the change for the engineer to accept, or leave --reason out to apply it now.`
        )
      : Result.succeed(Option.none());
  }

  return Option.match(Option.map(given, Str.trim), {
    onNone: () =>
      Result.fail(
        `--propose needs --reason, saying why the engineer should take the change. Add --reason "...".`
      ),
    onSome: (text) => {
      if (Str.isEmpty(text)) {
        return Result.fail(
          `--reason is empty. Say why you propose the change, such as --reason "Line up the ingest row".`
        );
      }

      return text.length > maxReasonLength
        ? Result.fail(
            `The reason is ${text.length} characters, over the limit of ${maxReasonLength}. Say it shorter.`
          )
        : Result.succeed(Option.some(text));
    },
  });
};

const gridFlag = (name: Field, description: string) =>
  Flag.Finite(name).pipe(Flag.withDescription(description), Flag.optional);

/* oxlint-disable perfectionist/sort-objects -- these keys set the argument and flag order `--help` prints, so they stay in the written order */
export const layoutCommand = Command.make(
  "layout",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and layout.json"
      )
    ),
    structure: Argument.String("structure").pipe(
      Argument.withDescription("The id of the structure to move or resize"),
      Argument.optional
    ),
    x: gridFlag("x", "Position along the grid's x axis, in grid units"),
    y: gridFlag("y", "Position along the grid's y axis, in grid units"),
    w: gridFlag("w", "Footprint width along x, in grid units"),
    d: gridFlag("d", "Footprint depth along y, in grid units"),
    hop: Flag.String("hop").pipe(
      Flag.withDescription("The id of the hop to reroute, with --route"),
      Flag.optional
    ),
    route: Flag.String("route").pipe(
      Flag.withDescription(
        "The hop's route: grid points from one footprint's edge to the other's, such as \"4,2 4,6 9,6\", or auto to clear the override"
      ),
      Flag.optional
    ),
    propose: Flag.Boolean("propose").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Write the change to proposals.json as the agent's pending layout change, for the engineer to accept or discard in the Pending tab, instead of to layout.json. Needs --reason"
      )
    ),
    reason: Flag.String("reason").pipe(
      Flag.withDescription(
        "Why you propose the change, with --propose. The engineer reads it in the Pending tab"
      ),
      Flag.optional
    ),
  },
  /* oxlint-enable perfectionist/sort-objects */
  ({ d, home, hop, propose: proposing, reason, route, structure, w, x, y }) => {
    const grid = Arr.some(fields, (field) =>
      Option.isSome({ d, w, x, y }[field])
    );

    const given = reasonOf(proposing, reason);

    if (Result.isFailure(given)) {
      return reject(given.failure);
    }

    const proposed = given.success;

    if (Option.isSome(hop) || Option.isSome(route)) {
      if (Option.isNone(hop) || Option.isNone(route)) {
        return reject(
          `Rerouting needs both --hop and --route. Give --hop <id> --route "4,2 4,6 9,6", or --route auto to clear the override.`
        );
      }

      if (Option.isSome(structure) || grid) {
        return reject(
          `Rerouting a hop takes --hop and --route alone. Run layout again for a structure's --x, --y, --w and --d.`
        );
      }

      return Option.match(proposed, {
        onNone: () => reroute(home, hop.value, route.value),
        onSome: (why) =>
          Result.match(routeOf(route.value), {
            onFailure: reject,
            onSuccess: (points) =>
              propose(home, { _tag: "Reroute", hop: hop.value, points }, why),
          }),
      });
    }

    if (Option.isNone(structure)) {
      return reject(
        `Say what to change. Name a structure to move or resize, or give --hop and --route to reroute a hop.`
      );
    }

    const changes = { d, w, x, y };

    return Option.match(proposed, {
      onNone: () => layout(home, structure.value, changes),
      onSome: (why) =>
        Option.match(valuesProblem(changes), {
          onNone: () =>
            propose(
              home,
              { _tag: "Place", changes, structure: structure.value },
              why
            ),
          onSome: reject,
        }),
    });
  }
).pipe(
  Command.withDescription(
    "Move or resize one structure, or reroute one hop, in layout.json, under the map's lock. Values land on half units, such as 4 or 4.5. Fields you leave out keep their value. With --propose, the change waits in proposals.json for the engineer instead."
  ),
  Command.withExamples([
    {
      command: "axonometric layout docs/pipeline/map gate --x 4 --y 2",
      description: "Move the gate structure",
    },
    {
      command: "axonometric layout docs/pipeline/map gate --w 3 --d 2",
      description: "Resize its footprint",
    },
    {
      command:
        'axonometric layout docs/pipeline/map --hop h-save --route "4,2 4,6 9,6"',
      description: "Reroute a hop through grid points",
    },
    {
      command: "axonometric layout docs/pipeline/map --hop h-save --route auto",
      description: "Clear the hop's route override",
    },
    {
      command:
        'axonometric layout docs/pipeline/map gate --x 8 --propose --reason "Line up the ingest row"',
      description: "Propose a move for the engineer to accept or discard",
    },
  ])
);
