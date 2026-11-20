import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { posixPath, stateFolderName } from "../src/home-paths.ts";
import { minimalMap } from "./fixtures.ts";
import { homeAt, makeHome, mapKeys, posixHomeAt, runCli } from "./harness.ts";

describe("home paths", () => {
  it("gives every path of a map for a home folder with spaces", () => {
    const paths = posixHomeAt("/work/my system/the map");

    assert.deepStrictEqual(
      {
        dataFile: paths.dataFile,
        gitignoreFile: paths.gitignoreFile,
        historyFolder: paths.historyFolder,
        homeFromOutput: paths.homeFromOutput,
        layoutFile: paths.layoutFile,
        lockFile: paths.lockFile,
        output: paths.output,
        pageFile: paths.pageFile,
        proposalsFile: paths.proposalsFile,
        revisionFile: paths.revisionFile(12),
        serverStateFile: paths.serverStateFile,
        stateFolder: paths.stateFolder,
        system: paths.system,
        systemMdFile: paths.systemMdFile,
      },
      {
        dataFile: "/work/my system/the map/data.mjs",
        gitignoreFile: "/work/my system/the map/.axonometric/.gitignore",
        historyFolder: "/work/my system/the map/history",
        homeFromOutput: "the map",
        layoutFile: "/work/my system/the map/layout.json",
        lockFile: "/work/my system/the map/.axonometric/lock",
        output: "/work/my system",
        pageFile: "/work/my system/my system.html",
        proposalsFile: "/work/my system/the map/proposals.json",
        revisionFile: "/work/my system/the map/history/0012.json",
        serverStateFile: "/work/my system/the map/.axonometric/server.json",
        stateFolder: "/work/my system/the map/.axonometric",
        system: "my system",
        systemMdFile: "/work/my system/SYSTEM.md",
      }
    );
  }, 5000);

  it("names files with / on every platform", () => {
    assert.strictEqual(
      posixPath({ sep: "\\" }, String.raw`map\history\0001.json`),
      "map/history/0001.json"
    );

    assert.strictEqual(
      posixPath({ sep: "/" }, "map/history/0001.json"),
      "map/history/0001.json"
    );
  }, 5000);

  it.effect(
    "matches the files the commands write, in a folder with spaces",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const files = yield* minimalMap;
        const root = yield* makeHome({});
        const paths = homeAt(path.join(root, "my system", "the map"));

        yield* fs.makeDirectory(paths.home, { recursive: true });
        yield* fs.writeFileString(
          paths.dataFile,
          files[mapKeys("pipeline").dataFile] ?? ""
        );
        yield* fs.writeFileString(
          paths.layoutFile,
          files[mapKeys("pipeline").layoutFile] ?? ""
        );

        const built = yield* runCli(root, ["build", paths.home]);

        assert.strictEqual(built.exitCode, 0, built.stderr);

        const written = [
          paths.dataFile,
          paths.layoutFile,
          paths.pageFile,
          paths.systemMdFile,
          paths.gitignoreFile,
        ];

        const exist = yield* Effect.forEach(
          written,
          (file) => fs.exists(file),
          {
            concurrency: 1,
          }
        );
        const lockExists = yield* fs.exists(paths.lockFile);

        assert.deepStrictEqual(exist, [true, true, true, true, true]);
        assert.isFalse(lockExists);
        assert.strictEqual(path.basename(paths.stateFolder), stateFolderName);
        const printed = built.stdout + built.stderr;

        assert.include(printed, paths.systemMdFile);
        assert.include(printed, paths.pageFile);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.effect(
    "makes test folders at their real path",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeHome({});
        const real = yield* fs.realPath(root);

        assert.strictEqual(root, real);
      }).pipe(Effect.provide(NodeServices.layer)),
    10_000
  );
});
