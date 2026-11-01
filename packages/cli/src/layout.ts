import { footprintsOverlap, formatProblem } from "@axonometric/contracts";
import type { Placement } from "@axonometric/contracts";
import {
  Array as Arr,
  Console,
  Effect,
  Option,
  Path,
  Record as Rec,
  Schema,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

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

const describePlacement = ({ x, y, w, d }: Placement) =>
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

const layout = Effect.fn("layout")(function* (
  home: string,
  id: string,
  changes: Changes
) {
  const path = yield* Path.Path;
  const problems = invalidValues(changes);

  if (Arr.every(fields, (field) => Option.isNone(changes[field]))) {
    return yield* reject(
      `Say what to change. Give at least one of --x, --y, --w and --d.`
    );
  }

  if (problems.length > 0) {
    return yield* reject(Arr.join(problems, " "));
  }

  yield* withLock(home, "layout");

  const map = yield* loadMap({
    home,
    output: path.dirname(home),
    command: "layout",
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

  const base = Option.getOrElse(before, () => ({ x: 0, y: 0, w: 2, d: 2 }));

  const after: Placement = {
    x: Option.getOrElse(changes.x, () => base.x),
    y: Option.getOrElse(changes.y, () => base.y),
    w: Option.getOrElse(changes.w, () => base.w),
    d: Option.getOrElse(changes.d, () => base.d),
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
      file: path.join(home, "layout.json"),
      content: yield* encodeLayout(next),
    },
  ]);

  const change = Option.match(before, {
    onNone: () => `placed at ${describePlacement(after)}`,
    onSome: (placement) => describeChanges(placement, after),
  });

  yield* Effect.forEach(
    map.warnings,
    (warning) => Console.error(formatProblem(warning)),
    { discard: true }
  );

  return yield* Console.log(
    `${id}: ${change}. layout.json is at revision ${revision}.`
  );
}, Effect.scoped);

const gridFlag = (name: Field, description: string) =>
  Flag.Finite(name).pipe(Flag.withDescription(description), Flag.optional);

export const layoutCommand = Command.make(
  "layout",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and layout.json"
      )
    ),
    structure: Argument.String("structure").pipe(
      Argument.withDescription("The id of the structure to move or resize")
    ),
    x: gridFlag("x", "Position along the grid's x axis, in half units"),
    y: gridFlag("y", "Position along the grid's y axis, in half units"),
    w: gridFlag("w", "Footprint width along x, in half units"),
    d: gridFlag("d", "Footprint depth along y, in half units"),
  },
  ({ home, structure, x, y, w, d }) => layout(home, structure, { x, y, w, d })
).pipe(
  Command.withDescription(
    "Move or resize one structure in layout.json, under the map's lock. Fields you leave out keep their value."
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
  ])
);
