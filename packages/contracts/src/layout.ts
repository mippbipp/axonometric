import {
  Array as Arr,
  Effect,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

import { describeCause } from "./cause.ts";
import { fileVersionFields, objectMessages } from "./fields.ts";

const gridValue = (name: string, meaning: string) =>
  Schema.Finite.annotate({
    message: `expected a number of grid units. Set ${name} to ${meaning}.`,
  })
    .check(
      Schema.makeFilter((value: number) => Number.isInteger(value * 2), {
        message: `expected a whole or half grid unit, such as 2 or 2.5. Round ${name} to the nearest half unit.`,
      })
    )
    .pipe(
      Schema.annotateKey({
        messageMissingKey: `missing. Set ${name} to ${meaning}.`,
      })
    );

const gridSize = (name: string, meaning: string) =>
  gridValue(name, meaning).check(
    Schema.isGreaterThan(0, {
      message: `expected more than 0. Give ${name} a size of at least half a unit.`,
    })
  );

/**
 * Where a structure sits and how much ground it covers, in grid units. Every
 * value lands on a half unit, so it round-trips exactly.
 */
export const Placement = Schema.Struct({
  x: gridValue("x", "the structure's position along the grid's x axis"),
  y: gridValue("y", "the structure's position along the grid's y axis"),
  w: gridSize("w", "the footprint's width along x"),
  d: gridSize("d", "the footprint's depth along y"),
}).annotate(objectMessages("A placement has only x, y, w and d."));

export type Placement = typeof Placement.Type;

/** A point on the ground grid, in grid units, on a half unit. */
export const GridPoint = Schema.Struct({
  x: gridValue("x", "the point's position along the grid's x axis"),
  y: gridValue("y", "the point's position along the grid's y axis"),
}).annotate(objectMessages("A route point has only x and y."));

export type GridPoint = typeof GridPoint.Type;

const routeFix =
  "Write a route override as a list of at least two points, such as [{ x: 2, y: 1 }, { x: 4, y: 1 }], where each point shares x or y with the one before it.";

const rightAngled = (points: readonly GridPoint[]) =>
  Arr.every(points, (point, index) => {
    const previous = points[index - 1];

    return (
      previous === undefined || previous.x === point.x || previous.y === point.y
    );
  });

/**
 * A route override: the points a hop's route runs through, from the edge of
 * one footprint to the edge of the other. Every leg runs along x or y.
 */
export const RouteOverride = Schema.Array(GridPoint)
  .annotate({ message: `expected an array of points. ${routeFix}` })
  .check(
    Schema.isMinLength(2, {
      message: `expected at least two points. ${routeFix}`,
    }),
    Schema.makeFilter(rightAngled, {
      message: `expected every leg to run along x or y. ${routeFix}`,
    })
  );

export type RouteOverride = typeof RouteOverride.Type;

/** `layout.json`: the accepted layout, keyed by structure id. */
export const Layout = Schema.Struct({
  ...fileVersionFields,
  structures: Schema.Record(Schema.String, Placement)
    .annotate({
      message:
        "expected an object keyed by structure id. Write structures as { [id]: { x, y, w, d } }.",
    })
    .pipe(
      Schema.annotateKey({
        messageMissingKey:
          "missing. Add structures: { [id]: { x, y, w, d } } with a placement for every structure.",
      })
    ),
  /** Route overrides, keyed by hop id. A hop without one routes itself. */
  routes: Schema.optionalKey(
    Schema.Record(Schema.String, RouteOverride).annotate({
      message:
        "expected an object keyed by hop id. Write routes as { [hopId]: [{ x, y }, ...] }.",
    })
  ),
}).annotate(
  objectMessages("A layout has only format, revision, structures and routes.")
);

export type Layout = typeof Layout.Type;

/**
 * JSON text, decoded to a JSON value. Unlike `Schema.fromJsonString`, a
 * syntax error reports Node's message, which gives the line and column.
 */
const JsonText = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transformEffect({
      decode: (text, options) =>
        Effect.try({
          try: () => {
            // oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- see above
            const parsed: unknown = JSON.parse(text);

            return parsed;
          },
          catch: (cause) =>
            new SchemaIssue.InvalidValue(
              {
                message: `isn't valid JSON: ${describeCause(cause)}. Fix the syntax.`,
              },
              text,
              options
            ),
        }),
      encode: (json) => Effect.succeed(`${JSON.stringify(json, null, 2)}\n`),
    })
  )
);

/** The text of `layout.json`, decoded to a layout. */
export const LayoutFile = JsonText.pipe(Schema.decodeTo(Layout));
