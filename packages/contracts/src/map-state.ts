import {
  Array as Arr,
  Predicate,
  Record as Rec,
  Schema,
  SchemaIssue,
} from "effect";
import { dual } from "effect/Function";

import { Layout } from "./layout.ts";
import { MapData } from "./map-data.ts";

/** Everything a view needs to draw a map. */
export const MapState = Schema.Struct({
  /** The name of the system the map describes. */
  system: Schema.String,
  data: MapData,
  layout: Layout,
});

export type MapState = typeof MapState.Type;

/**
 * The id of the `<script type="application/json">` element that carries the
 * map state in a read-only page.
 */
export const mapStateElementId = "axonometric-map-state";

/** The map files a problem can be in. */
export const MapFile = Schema.Literals(["data.mjs", "layout.json"]);

export type MapFile = typeof MapFile.Type;

/** One thing wrong with a map file, and how to fix it. */
export const MapProblem = Schema.Struct({
  file: MapFile,
  /** Where in the file, such as `structures[1].id`. Empty for the whole file. */
  path: Schema.String,
  message: Schema.String,
});

export type MapProblem = typeof MapProblem.Type;

const identifier = /^[A-Za-z_$][\w$]*$/u;

const formatPath = (path: readonly PropertyKey[]) =>
  Arr.join(
    Arr.map(path, (key, index) => {
      if (Predicate.isNumber(key)) {
        return `[${key}]`;
      }

      const name = String(key);

      if (!identifier.test(name)) {
        return `[${JSON.stringify(name)}]`;
      }

      return index === 0 ? name : `.${name}`;
    }),
    ""
  );

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** Lists every failure in a schema issue as a problem in `file`. */
export const problemsFromIssue: {
  (issue: SchemaIssue.Issue): (file: MapFile) => readonly MapProblem[];
  (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[];
} = dual(2, (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[] =>
  Arr.map(formatter(issue).issues, (failure) => ({
    file,
    path: formatPath(
      Arr.map(failure.path ?? [], (segment) =>
        Predicate.isPropertyKey(segment) ? segment : segment.key
      )
    ),
    message: failure.message,
  }))
);

/**
 * Checks that the layout places every structure in the data. Both files have
 * already passed their own schemas.
 */
export const crossCheck: {
  (layout: Layout): (data: MapData) => readonly MapProblem[];
  (data: MapData, layout: Layout): readonly MapProblem[];
} = dual(2, (data: MapData, layout: Layout): readonly MapProblem[] =>
  Arr.flatMap(data.structures, (structure, index) =>
    Rec.has(layout.structures, structure.id)
      ? []
      : [
          {
            file: "layout.json" as const,
            path: formatPath(["structures", structure.id]),
            message: `missing. structures[${index}] in data.mjs has no placement. Add "${structure.id}": { "x": 0, "y": 0, "w": 2, "d": 2 } to structures, at a free spot.`,
          },
        ]
  )
);

/** Formats a problem as one line, such as `data.mjs structures[1].id: ...`. */
export const formatProblem = (problem: MapProblem) =>
  problem.path === ""
    ? `${problem.file}: ${problem.message}`
    : `${problem.file} ${problem.path}: ${problem.message}`;
