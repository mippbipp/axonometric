import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

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
}).annotate(
  objectMessages("A layout has only format, revision and structures.")
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
