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

/** The `data-faded` of the part `kind`-`id` of chapter 8's SVG. */
const fadedOf = (text: string, kind: string, id: string) => {
  const tag = new RegExp(
    `<g id="flake-pipeline-iso-chapter-8-${kind}-${id}"[^>]*>`,
    "u"
  ).exec(text)?.[0];

  return /data-faded="(?<value>[^"]*)"/u.exec(tag ?? "")?.groups?.value;
};

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

    it.effect("--flow draws a picked flow's hops in the spotlight", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* pipelineMap);
        const map = path.join(home, "flake-pipeline", "map");
        const file = "flake-pipeline/flake-pipeline-iso-chapter-8.svg";

        const stale = yield* runCli(home, ["export", map, "--flow", "f-stale"]);

        assert.strictEqual(stale.exitCode, 0, stale.stderr);

        const staleText = stale.files[file] ?? "";

        assert.strictEqual(
          fadedOf(staleText, "hop", "h-main-watchdog"),
          "false"
        );
        assert.strictEqual(fadedOf(staleText, "hop", "h-pr-build"), "true");
        assert.strictEqual(
          fadedOf(staleText, "structure", "watchdog"),
          "false"
        );
        assert.strictEqual(fadedOf(staleText, "structure", "build"), "true");

        // The last chapter plays nothing, so no --flow means all flows.
        const all = yield* runCli(home, ["export", map, "--flow", "all"]);
        const none = yield* runCli(home, ["export", map]);

        assert.strictEqual(all.files[file], none.files[file]);
        assert.notInclude(all.files[file] ?? "", 'data-faded="true"');
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("--flow names a flow of the map, in the last chapter", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* pipelineMap);
        const map = path.join(home, "flake-pipeline", "map");

        const unknown = yield* runCli(home, [
          "export",
          map,
          "--flow",
          "f-nope",
        ]);

        assert.strictEqual(unknown.exitCode, 1);
        assert.include(unknown.stderr, 'Unknown flow "f-nope"');
        assert.include(unknown.stderr, "f-weekly");
        assert.include(unknown.stderr, "export wrote nothing.");

        const early = yield* runCli(home, [
          "export",
          map,
          "--chapter",
          "2",
          "--flow",
          "f-stale",
        ]);

        assert.strictEqual(early.exitCode, 1);
        assert.include(early.stderr, "isn't the last");
        assert.include(early.stderr, "export wrote nothing.");
        assert.isUndefined(
          early.files["flake-pipeline/flake-pipeline-iso-chapter-2.svg"]
        );
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

          assert.strictEqual(result.exitCode, 0, result.stderr);
          assert.isDefined(result.files["crowded/crowded-iso-chapter-1.svg"]);
        }
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
