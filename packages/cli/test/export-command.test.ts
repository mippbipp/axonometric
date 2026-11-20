import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Order,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { stateFolderName } from "../src/home-paths.ts";
import { crowdedMap, minimalMap, pipelineMap } from "./fixtures.ts";
import { makeHome, runCli, mapKeys, mapIn } from "./harness.ts";
import type { HomeFiles } from "./harness.ts";

/** The files in the home folder that are the map's own, not the lock's. */
const mapFiles = (files: HomeFiles) =>
  Arr.sort(
    Arr.filter(
      Rec.keys(files),
      (name) => !Str.includes(`${stateFolderName}/`)(name)
    ),
    Order.String
  );

/**
 * The parts of a `.excalidraw` file these tests read, as Excalidraw's format
 * describes it: a scene of elements, each text element labelling a box or an
 * arrow, and a frame per group.
 */
const SceneElement = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  originalText: Schema.optionalKey(Schema.String),
  type: Schema.String,
});

const ExcalidrawScene = Schema.fromJsonString(
  Schema.Struct({
    appState: Schema.Struct({ viewBackgroundColor: Schema.String }),
    elements: Schema.Array(SceneElement),
    type: Schema.Literal("excalidraw"),
    version: Schema.Literal(2),
  })
);

type Scene = typeof ExcalidrawScene.Type;

const decodeScene = Schema.decodeUnknownEffect(ExcalidrawScene);

/** How many elements of each type `scene` has. */
const countsOf = (scene: Scene) =>
  Rec.map(
    Arr.groupBy(scene.elements, ({ type }) => type),
    (elements) => elements.length
  );

/** The text of every text element in `scene`. */
const textsOf = (scene: Scene) =>
  Arr.flatMap(scene.elements, ({ originalText }) =>
    originalText === undefined ? [] : [originalText]
  );

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
    it.effect("writes the map as an Excalidraw scene, next to SYSTEM.md", () =>
      Effect.gen(function* () {
        const pipelineMapFiles = yield* pipelineMap;
        const home = yield* makeHome(pipelineMapFiles);
        const map = mapIn(home, "flake-pipeline").home;

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.include(result.stdout, "flake-pipeline.excalidraw");

        const scene = yield* decodeScene(
          result.files["flake-pipeline/flake-pipeline.excalidraw"] ?? ""
        );

        // The pipeline map has 15 structures, 29 hops and 4 groups. Each
        // structure and hop carries its name or label as a text element.
        assert.deepStrictEqual(countsOf(scene), {
          arrow: 29,
          frame: 4,
          rectangle: 15,
          text: 44,
        });

        const texts = textsOf(scene);

        for (const text of [
          "Flake updater",
          "Flake fixer",
          "merge main",
          "nix flake update",
        ]) {
          assert.include(texts, text);
        }

        assert.include(
          Arr.map(scene.elements, ({ name }) => name),
          "pewter (aarch64 VM)"
        );
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("--background white sets the canvas colour like the page", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const crowdedMapFiles = yield* crowdedMap;
        const home = yield* makeHome(crowdedMapFiles);
        const map = mapIn(home, "crowded").home;

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
          const files = yield* minimalMap;

          const home = yield* makeHome({
            ...files,
            [mapKeys("pipeline").layoutFile]:
              '{"format":1,"revision":0,"structures":{}}',
          });

          const map = mapIn(home, "pipeline").home;

          // The default name is the page's, the system alone, whatever the
          // view and chapter.
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
          assert.strictEqual(
            result.files[mapKeys("pipeline").layoutFile],
            '{"format":1,"revision":0,"structures":{}}'
          );
          assert.isUndefined(result.files[mapKeys("pipeline").systemMdFile]);
          assert.isUndefined(result.files[mapKeys("pipeline").pageFile]);
        }).pipe(Effect.provide(NodeServices.layer))
    );
  });

  describe("the default file name", () => {
    it.effect("--output wins and its folders are created", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const minimalMapFiles = yield* minimalMap;
        const home = yield* makeHome(minimalMapFiles);
        const map = mapIn(home, "pipeline").home;

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
          const minimalMapFiles = yield* minimalMap;
          const home = yield* makeHome(minimalMapFiles);
          const map = mapIn(home, "pipeline").home;

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
            mapKeys("pipeline").dataFile,
            mapKeys("pipeline").layoutFile,
          ]);
        }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect("an unknown chapter lists the chapters, by number and id", () =>
      Effect.gen(function* () {
        const crowdedMapFiles = yield* crowdedMap;
        const home = yield* makeHome(crowdedMapFiles);
        const map = mapIn(home, "crowded").home;

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

    it.effect(
      "--flow draws a picked flow's hops in the spotlight",
      () =>
        Effect.gen(function* () {
          const pipelineMapFiles = yield* pipelineMap;
          const home = yield* makeHome(pipelineMapFiles);
          const map = mapIn(home, "flake-pipeline").home;
          const file = "flake-pipeline/flake-pipeline-iso-chapter-8.svg";

          const stale = yield* runCli(home, [
            "export",
            map,
            "--flow",
            "f-stale",
          ]);

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
        }).pipe(Effect.provide(NodeServices.layer)),
      // Three exports of a 29-hop map, each placing every hop's label.
      60_000
    );

    it.effect("--flow names a flow of the map, in the last chapter", () =>
      Effect.gen(function* () {
        const pipelineMapFiles = yield* pipelineMap;
        const home = yield* makeHome(pipelineMapFiles);
        const map = mapIn(home, "flake-pipeline").home;

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
        const crowdedMapFiles = yield* crowdedMap;
        const home = yield* makeHome(crowdedMapFiles);
        const map = mapIn(home, "crowded").home;

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

  describe("the lock", () => {
    it.effect("takes and releases the lock", () =>
      Effect.gen(function* () {
        const minimalMapFiles = yield* minimalMap;
        const home = yield* makeHome(minimalMapFiles);
        const map = mapIn(home, "pipeline").home;

        const result = yield* runCli(home, [
          "export",
          map,
          "--format",
          "excalidraw",
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        // Taking the lock makes .axonometric/ with its .gitignore.
        assert.isDefined(result.files[mapKeys("pipeline").gitignoreFile]);
        assert.isUndefined(result.files[mapKeys("pipeline").lockFile]);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  });
});
