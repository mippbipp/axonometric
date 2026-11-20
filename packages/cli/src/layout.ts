import {
  defaultFootprint,
  footprintsOverlap,
  formatProblem,
  onOutline,
} from "@axonometric/contracts";
import type { GridPoint, Layout, Placement } from "@axonometric/contracts";
import {
  Array as Arr,
  Console,
  Effect,
  Option,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import { homePaths } from "./home-paths.ts";
import { withLock } from "./lock.ts";
import { encodeLayout, loadMap } from "./map-files.ts";
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
const invalidValues = (changes: Changes) =>
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

  const route =
    Str.trim(routeText) === "auto"
      ? Result.succeed(null)
      : parseRoute(routeText);

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
    return yield* reject(
      `No hop in data.mjs has the id "${hopId}". Use one of: ${Arr.join(
        Arr.map(map.data.hops, ({ id }) => id),
        ", "
      )}.`
    );
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
      : `${hopId}: route saved through ${Arr.join(
          Arr.map(points, ({ x, y }) => `${x},${y}`),
          " "
        )}. layout.json is at revision ${revision}.`
  );
}, Effect.scoped);

const layout = Effect.fn("layout")(function* (
  home: string,
  id: string,
  changes: Changes
) {
  const paths = yield* homePaths(home);
  const problems = invalidValues(changes);

  if (Arr.every(fields, (field) => Option.isNone(changes[field]))) {
    return yield* reject(
      `Say what to change. Give at least one of --x, --y, --w and --d.`
    );
  }

  if (problems.length > 0) {
    return yield* reject(Arr.join(problems, " "));
  }

  yield* withLock(paths, "layout");

  const map = yield* loadMap({
    command: "layout",
    drawingWarnings: true,
    paths,
  });

  const ids = Arr.map(map.data.structures, (structure) => structure.id);

  if (!ids.includes(id)) {
    return yield* reject(
      `No structure in data.mjs has the id "${id}". Use one of: ${Arr.join(ids, ", ")}.`
    );
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

  const after: Placement = {
    d: Option.getOrElse(changes.d, () => base.d),
    w: Option.getOrElse(changes.w, () => base.w),
    x: Option.getOrElse(changes.x, () => base.x),
    y: Option.getOrElse(changes.y, () => base.y),
  };

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
  },
  /* oxlint-enable perfectionist/sort-objects */
  ({ d, home, hop, route, structure, w, x, y }) => {
    const grid = Arr.some(fields, (field) =>
      Option.isSome({ d, w, x, y }[field])
    );

    if (Option.isSome(hop) || Option.isSome(route)) {
      if (Option.isNone(hop) || Option.isNone(route)) {
        return reject(
          `Rerouting needs both --hop and --route. Give --hop <id> --route "4,2 4,6 9,6", or --route auto to clear the override.`
        );
      }

      return Option.isSome(structure) || grid
        ? reject(
            `Rerouting a hop takes --hop and --route alone. Run layout again for a structure's --x, --y, --w and --d.`
          )
        : reroute(home, hop.value, route.value);
    }

    return Option.isNone(structure)
      ? reject(
          `Say what to change. Name a structure to move or resize, or give --hop and --route to reroute a hop.`
        )
      : layout(home, structure.value, { d, w, x, y });
  }
).pipe(
  Command.withDescription(
    "Move or resize one structure, or reroute one hop, in layout.json, under the map's lock. Values land on half units, such as 4 or 4.5. Fields you leave out keep their value."
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
  ])
);
