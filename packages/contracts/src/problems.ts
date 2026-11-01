import { Array as Arr, Predicate, Result, Schema, SchemaIssue } from "effect";
import { dual } from "effect/Function";

/** The map files a problem can be in, `history/<n>.json` included. */
export const MapFile = Schema.Union([
  Schema.Literals(["data.mjs", "layout.json", "proposals.json"]),
  Schema.TemplateLiteral(["history/", Schema.String, ".json"]).check(
    Schema.isPattern(/^history\/\d{4,}\.json$/u, {
      message: "expected history/ and four or more digits, then .json.",
    })
  ),
]);

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

/** Where a problem is and what's wrong. An empty path means the whole file. */
interface ProblemAt {
  readonly file: MapFile;
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

const make =
  (severity: Severity) =>
  ({ file, path, message }: ProblemAt): MapProblem => ({
    severity,
    file,
    path: formatPath(path),
    message,
  });

/** An error, which stops `build`. */
export const mapError = make("error");

/** A warning, which `build` prints and goes ahead. */
export const mapWarning = make("warning");

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** Lists every failure in a schema issue as an error in `file`. */
export const problemsFromIssue: {
  (issue: SchemaIssue.Issue): (file: MapFile) => readonly MapProblem[];
  (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[];
} = dual(2, (file: MapFile, issue: SchemaIssue.Issue): readonly MapProblem[] =>
  Arr.map(formatter(issue).issues, (failure) =>
    mapError({
      file,
      path: Arr.map(failure.path ?? [], (segment) =>
        Predicate.isPropertyKey(segment) ? segment : segment.key
      ),
      message: failure.message,
    })
  )
);

/**
 * Formats a problem as one line, such as
 * `error data.mjs structures[1].id: ...`.
 */
export const formatProblem = (problem: MapProblem) =>
  problem.path === ""
    ? `${problem.severity} ${problem.file}: ${problem.message}`
    : `${problem.severity} ${problem.file} ${problem.path}: ${problem.message}`;

/** Splits `problems` into errors and warnings, each in their original order. */
export const splitProblems = (problems: readonly MapProblem[]) => {
  const [errors, warnings] = Arr.partition(problems, (problem) =>
    problem.severity === "error"
      ? Result.succeed(problem)
      : Result.fail(problem)
  );

  return { errors, warnings };
};

/** Formats a count of problems, such as `1 error` or `2 warnings`. */
export const formatCount: {
  (severity: Severity): (count: number) => string;
  (count: number, severity: Severity): string;
} = dual(
  2,
  (count: number, severity: Severity) =>
    `${count} ${severity}${count === 1 ? "" : "s"}`
);
