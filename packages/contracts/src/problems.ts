import { Array as Arr, Predicate, Schema, SchemaIssue } from "effect";
import { dual } from "effect/Function";

/** The map files a problem can be in. */
export const MapFile = Schema.Literals(["data.mjs", "layout.json"]);

export type MapFile = typeof MapFile.Type;

/**
 * How bad a problem is. An error stops `build`; a warning is printed and
 * the build goes ahead.
 */
export const Severity = Schema.Literals(["error", "warning"]);

export type Severity = typeof Severity.Type;

/** One thing wrong with a map file, and how to fix it. */
export const MapProblem = Schema.Struct({
  severity: Severity,
  file: MapFile,
  /** Where in the file, such as `structures[1].id`. Empty for the whole file. */
  path: Schema.String,
  message: Schema.String,
});

export type MapProblem = typeof MapProblem.Type;

const identifier = /^[A-Za-z_$][\w$]*$/u;

/** Formats a path such as `["structures", 1, "id"]` as `structures[1].id`. */
export const formatPath = (path: readonly PropertyKey[]) =>
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

/** Lists every failure in a schema issue as an error in `file`. */
export const problemsFromIssue: {
  (issue: SchemaIssue.Issue): (file: MapFile) => readonly MapProblem[];
  (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[];
} = dual(2, (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[] =>
  Arr.map(formatter(issue).issues, (failure) => ({
    severity: "error" as const,
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
 * Formats a problem as one line, such as
 * `error data.mjs structures[1].id: ...`.
 */
export const formatProblem = (problem: MapProblem) =>
  problem.path === ""
    ? `${problem.severity} ${problem.file}: ${problem.message}`
    : `${problem.severity} ${problem.file} ${problem.path}: ${problem.message}`;

/** Whether any of `problems` is an error. */
export const hasErrors = (problems: readonly MapProblem[]) =>
  Arr.some(problems, (problem) => problem.severity === "error");
