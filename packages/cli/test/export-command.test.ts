import { excalidrawOf, excalidrawText, MapState } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { crowdedMap, minimalMap, pipelineMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";
import type { HomeFiles } from "./harness.ts";

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(MapState));

/** The files in the home folder that are the map's own, not the lock's. */
const mapFiles = (files: HomeFiles) =>
  Arr.sort(
    Arr.filter(Rec.keys(files), (name) => !Str.includes(".axonometric/")(name)),
    Order.String
  );

/**
 * What the page's Export menu saves for the same map: `excalidrawOf` of the
 * state `build` embeds in the page, which holds the layout `build` placed.
 */
const expectedExcalidraw = Effect.fnUntraced(function* (
  home: string,
  system: string,
  background?: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const map = path.join(home, system, "map");

  const built = yield* runCli(home, ["build", map]);

  assert.strictEqual(built.exitCode, 0, built.stderr);

  const page = yield* fs.readFileString(
    path.join(home, system, `${system}.html`)
  );

  const json = Option.fromNullishOr(
    /id="axonometric-map-state">(?<json>.*?)<\/script>/su.exec(page)?.groups
      ?.json
  );

  const state = yield* decodeState(Option.getOrThrow(json));

  return excalidrawText(
    excalidrawOf({ data: state.data, layout: state.layout, background })
  );
});

describe("export", () => {
  describe("--format excalidraw", () => {
    it.effect(
      "writes what excalidrawOf gives for the same map, next to SYSTEM.md",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const home = yield* makeHome(yield* pipelineMap);
          const map = path.join(home, "flake-pipeline", "map");

          const result = yield* runCli(home, [
            "export",
            map,
            "--format",
            "excalidraw",
          ]);

          assert.strictEqual(result.exitCode, 0, result.stderr);
          assert.include(result.stdout, "flake-pipeline.excalidraw");

          const written =
            result.files["flake-pipeline/flake-pipeline.excalidraw"];

          assert.isDefined(written);
          assert.strictEqual(
            written,
            yield* expectedExcalidraw(home, "flake-pipeline")
          );
        }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("--background white sets the canvas colour like the page", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* crowdedMap);
        const map = path.join(home, "crowded", "map");

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
          "--background",
          "white",
          "--output",
          path.join(home, "out", "crowded.excalidraw"),
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.strictEqual(
          result.files["out/crowded.excalidraw"],
          yield* expectedExcalidraw(home, "crowded", "#ffffff")
        );
        assert.include(
          result.files["out/crowded.excalidraw"],
          '"viewBackgroundColor": "#ffffff"'
        );
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect(
      "places structures that have no position, and saves nothing else",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const files = yield* minimalMap;

          const home = yield* makeHome({
            ...files,
            "pipeline/map/layout.json":
              '{"format":1,"revision":0,"structures":{}}',
          });

          const map = path.join(home, "pipeline", "map");

          const result = yield* runCli(home, [
            "export",
            map,
            "--format",
            "excalidraw",
          ]);

          assert.strictEqual(result.exitCode, 0, result.stderr);
          assert.isDefined(result.files["pipeline/pipeline.excalidraw"]);
          assert.strictEqual(
            result.files["pipeline/map/layout.json"],
            '{"format":1,"revision":0,"structures":{}}'
          );
          assert.isUndefined(result.files["pipeline/SYSTEM.md"]);
          assert.isUndefined(result.files["pipeline/pipeline.html"]);
        }).pipe(Effect.provide(NodeServices.layer))
    );
  });

  describe("the default file name", () => {
    it.effect("is the page's name, for Excalidraw: the system alone", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* minimalMap);
        const map = path.join(home, "pipeline", "map");

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
          "--view",
          "plan",
          "--chapter",
          "1",
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.isDefined(result.files["pipeline/pipeline.excalidraw"]);
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("--output wins and its folders are created", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* minimalMap);
        const map = path.join(home, "pipeline", "map");

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
          "-o",
          path.join(home, "pictures", "deep", "map.excalidraw"),
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.isDefined(result.files["pictures/deep/map.excalidraw"]);
        assert.isUndefined(result.files["pipeline/pipeline.excalidraw"]);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  });

  describe("options", () => {
    it.effect.each([
      ["--format", "gif", ["svg", "png", "excalidraw"]],
      ["--view", "side", ["iso", "plan"]],
      ["--background", "black", ["paper", "white"]],
    ] as const)(
      "an unknown %s %s lists the valid values",
      ([flag, value, valid]) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const home = yield* makeHome(yield* minimalMap);
          const map = path.join(home, "pipeline", "map");

          const result = yield* runCli(home, ["export", map, flag, value]);

          assert.strictEqual(result.exitCode, 1);
          assert.include(
            result.stderr,
            `Invalid value for flag ${flag}: "${value}"`
          );

          for (const name of valid) {
            assert.include(result.stderr, `"${name}"`);
          }

          assert.deepStrictEqual(mapFiles(result.files), [
            "pipeline/map/data.mjs",
            "pipeline/map/layout.json",
          ]);
        }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("an unknown chapter lists the chapters, by number and id", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* crowdedMap);
        const map = path.join(home, "crowded", "map");

        for (const chapter of ["c-nope", "0", "3"]) {
          const result = yield* runCli(home, [
            "export",
            map,
            "--format",
            "excalidraw",
            "--chapter",
            chapter,
          ]);

          assert.strictEqual(result.exitCode, 1);
          assert.include(result.stderr, `Unknown chapter "${chapter}"`);
          assert.include(result.stderr, "from 1 to 2");
          assert.include(result.stderr, "1 (c-edge)");
          assert.include(result.stderr, "2 (c-all)");
          assert.include(result.stderr, "export wrote nothing.");
          assert.isUndefined(result.files["crowded/crowded.excalidraw"]);
        }
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("finds a chapter by id or by number before drawing", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* crowdedMap);
        const map = path.join(home, "crowded", "map");

        for (const chapter of ["c-edge", "1"]) {
          const result = yield* runCli(home, [
            "export",
            map,
            "--format",
            "svg",
            "--chapter",
            chapter,
          ]);

          // The chapter was found, so the command got as far as drawing.
          assert.strictEqual(result.exitCode, 1);
          assert.notInclude(result.stderr, "Unknown chapter");
          assert.include(result.stderr, "isn't available yet");
        }
      }).pipe(Effect.provide(NodeServices.layer))
    );
  });

  describe("--format svg and png", () => {
    it.effect.each(["svg", "png"] as const)(
      "%s says it isn't available yet and writes nothing",
      (format) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const home = yield* makeHome(yield* minimalMap);
          const map = path.join(home, "pipeline", "map");

          const result = yield* runCli(home, [
            "export",
            map,
            "--format",
            format,
          ]);

          assert.strictEqual(result.exitCode, 1);
          assert.include(
            result.stderr,
            `--format ${format} isn't available yet`
          );
          assert.include(result.stderr, "--format excalidraw");
          assert.deepStrictEqual(mapFiles(result.files), [
            "pipeline/map/data.mjs",
            "pipeline/map/layout.json",
          ]);
        }).pipe(Effect.provide(NodeServices.layer))
    );
  });

  describe("validation and the lock", () => {
    it.effect("a map with an error is not exported", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const files = yield* minimalMap;

        const home = yield* makeHome({
          ...files,
          "pipeline/map/data.mjs": "export default {};\n",
        });

        const map = path.join(home, "pipeline", "map");

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
        ]);

        assert.strictEqual(result.exitCode, 1);
        assert.include(result.stderr, "export wrote nothing.");
        assert.isUndefined(result.files["pipeline/pipeline.excalidraw"]);
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("takes and releases the lock", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* minimalMap);
        const map = path.join(home, "pipeline", "map");

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.isUndefined(result.files["pipeline/map/.axonometric/lock"]);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  });
});
