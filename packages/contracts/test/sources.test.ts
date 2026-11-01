import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Result, Schema } from "effect";

import {
  checkMap,
  problemsFromIssue,
  SourceFact,
  Structure,
} from "../src/index.ts";
import type { Layout, MapData, Source, SourceFacts } from "../src/index.ts";

const decodeStructure = Schema.decodeUnknownResult(Structure, {
  errors: "all",
  onExcessProperty: "error",
});

const base = {
  id: "api",
  code: "A",
  name: "API",
  shape: "gate",
  group: "service",
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
};

/** The problems decoding a structure with `sources` gives, as `path: message`. */
const sourceProblems = (sources: readonly object[]) =>
  Result.match(decodeStructure({ ...base, sources }), {
    onSuccess: () => [],
    onFailure: (error) =>
      Arr.map(
        problemsFromIssue("data.mjs", error.issue),
        ({ path, message }) => `${path}: ${message}`
      ),
  });

describe("structure sources", () => {
  it.effect("accepts sources with and without a commit", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        sourceProblems([
          { path: "src/server.ts", commit: "3f2a9c1" },
          { path: "docs/../README.md" },
        ]),
        []
      );
    })
  );

  it.effect(
    "rejects an absolute path, saying to write it from the repo's root",
    () =>
      Effect.sync(() => {
        const [unix, windows] = [
          sourceProblems([{ path: "/home/me/repo/src/server.ts" }]),
          sourceProblems([{ path: "C:/repo/src/server.ts" }]),
        ];

        assert.lengthOf(unix, 1);
        assert.include(
          unix[0],
          "sources[0].path: expected a path from the repo's root, not an absolute path."
        );
        assert.include(unix[0], "from the root of the git repo");
        assert.lengthOf(windows, 1);
      })
  );

  it.effect("rejects a path that names the repo's root, not a file", () =>
    Effect.sync(() => {
      for (const path of [".", "./", "src/..", "a/./b/../.."]) {
        const problems = sourceProblems([{ path }]);

        assert.lengthOf(problems, 1, path);
        assert.include(
          problems[0],
          `sources[0].path: expected a path to a file, but "${path}" is the repo's root.`
        );
      }
    })
  );

  it.effect("rejects a path whose .. segments leave the repo", () =>
    Effect.sync(() => {
      const problems = sourceProblems([{ path: "src/../../outside.ts" }]);

      assert.lengthOf(problems, 1);
      assert.include(
        problems[0],
        'sources[0].path: expected a path inside the git repo, but the ".." segments climb out of it.'
      );
    })
  );

  it.effect("rejects a commit that isn't a hex hash", () =>
    Effect.sync(() => {
      const problems = sourceProblems([
        { path: "src/server.ts", commit: "main; rm -rf" },
      ]);

      assert.lengthOf(problems, 1);
      assert.include(
        problems[0],
        "sources[0].commit: expected a commit hash of 7 to 64 hex digits"
      );
    })
  );

  it.effect("names the fields a source has", () =>
    Effect.sync(() => {
      const problems = sourceProblems([{ path: "src/a.ts", lines: "1-4" }]);

      assert.include(
        problems[0],
        "sources[0].lines: unknown field. A source has only path and commit"
      );
    })
  );
});

const layout: Layout = { format: 1, revision: 0, structures: {} };

const mapWith = (sources: readonly Source[]): MapData => ({
  format: 1,
  revision: 0,
  overview: { title: "T", summary: "S" },
  groups: [{ id: "service", title: "Service" }],
  structures: [
    {
      ...base,
      shape: "gate",
      status: "live",
      sources,
    },
  ],
  hops: [],
  flows: [],
  chapters: [],
});

const pinned = { path: "src/server.ts", commit: "3f2a9c1" };

/** Checks one structure whose only source has `fact`, as `severity path: message`. */
const check = (source: Source, fact?: SourceFact) => {
  const facts: SourceFacts | undefined =
    fact === undefined ? undefined : () => fact;

  return Arr.map(
    checkMap(
      { data: mapWith([source]), layout },
      { linkExists: () => true, sourceFacts: facts }
    ),
    ({ severity, path, message }) => `${severity} ${path}: ${message}`
  );
};

describe("checkMap's source checks", () => {
  it.effect("passes a pinned source that hasn't changed", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        check(
          pinned,
          SourceFact.cases.Pinned.make({
            commit: "3f2a9c1",
            atCommit: true,
            atHead: true,
            changed: false,
          })
        ),
        []
      );
    })
  );

  it.effect("errors on a path missing at its pinned commit", () =>
    Effect.sync(() => {
      const [problem, ...rest] = check(
        pinned,
        SourceFact.cases.Pinned.make({
          commit: "3f2a9c1",
          atCommit: false,
          atHead: false,
          changed: false,
        })
      );

      assert.deepStrictEqual(rest, []);
      assert.include(
        problem,
        'error structures[0].sources[0].path: "src/server.ts" doesn\'t exist at commit 3f2a9c1.'
      );
      assert.include(problem, 'structure "api"');
    })
  );

  it.effect(
    "errors on an unpinned path that isn't a tracked file at HEAD",
    () =>
      Effect.sync(() => {
        const [problem] = check(
          { path: "src/servr.ts" },
          SourceFact.cases.Unpinned.make({ atHead: false })
        );

        assert.include(
          problem,
          'error structures[0].sources[0].path: "src/servr.ts" isn\'t a file git tracks at HEAD.'
        );
        assert.include(problem, 'structure "api"');
      })
  );

  it.effect("passes an unpinned path that's a tracked file at HEAD", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        check(
          { path: "src/server.ts" },
          SourceFact.cases.Unpinned.make({ atHead: true })
        ),
        []
      );
    })
  );

  it.effect(
    "errors on a commit that isn't in the local history, saying to fetch",
    () =>
      Effect.sync(() => {
        const [problem] = check(
          pinned,
          SourceFact.cases.UnknownCommit.make({ commit: "3f2a9c1" })
        );

        assert.include(
          problem,
          "error structures[0].sources[0].commit: commit 3f2a9c1 isn't in the local git history. Run git fetch"
        );
        assert.include(problem, 'fix the hash in structure "api"');
      })
  );

  it.effect(
    "warns when the file changed between the pinned commit and HEAD",
    () =>
      Effect.sync(() => {
        const [problem] = check(
          pinned,
          SourceFact.cases.Pinned.make({
            commit: "3f2a9c1",
            atCommit: true,
            atHead: true,
            changed: true,
          })
        );

        assert.include(
          problem,
          'warning structures[0].sources[0].path: "src/server.ts" changed between commit 3f2a9c1 and HEAD. Reread structure "api"'
        );
      })
  );

  it.effect("warns when the file is at the pinned commit but not at HEAD", () =>
    Effect.sync(() => {
      const [problem] = check(
        pinned,
        SourceFact.cases.Pinned.make({
          commit: "3f2a9c1",
          atCommit: true,
          atHead: false,
          changed: false,
        })
      );

      assert.include(
        problem,
        'warning structures[0].sources[0].path: "src/server.ts" exists at commit 3f2a9c1 but not at HEAD, so it was renamed or deleted. Reread structure "api"'
      );
    })
  );

  it.effect("warns about a structure that lists one file twice", () =>
    Effect.sync(() => {
      const problems = Arr.map(
        checkMap(
          {
            data: mapWith([
              pinned,
              { path: "./src/server.ts" },
              { path: "src/other.ts" },
            ]),
            layout,
          },
          {
            linkExists: () => true,
            sourceFacts: () => SourceFact.cases.Unpinned.make({ atHead: true }),
          }
        ),
        ({ severity, path, message }) => `${severity} ${path}: ${message}`
      );

      assert.lengthOf(problems, 1);
      assert.include(
        problems[0],
        'warning structures[0].sources[1].path: structure "api" already lists "src/server.ts", so the page and SYSTEM.md show it once.'
      );
    })
  );

  it.effect("skips the source checks when there are no git facts", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(check(pinned), []);
    })
  );
});
