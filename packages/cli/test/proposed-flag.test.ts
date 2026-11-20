import { LayoutFile } from "@axonometric/contracts";
import type { LayoutChange } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { encodeProposals } from "../src/map-files.ts";
import { minimalMap } from "./fixtures.ts";
import { makeHome, mapIn, mapKeys, runCli } from "./harness.ts";
import type { HomeFiles } from "./harness.ts";

const { layoutFile, proposalsFile } = mapKeys("pipeline");

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);
const encodeLayout = Schema.encodeEffect(LayoutFile);

/** The engineer's pending move of the gate above the updater. */
const engineersMove: LayoutChange = {
  by: "engineer",
  id: "c1",
  kind: "move",
  moves: [
    { position: { x: 0, y: 2.5 }, target: { id: "gate", kind: "structure" } },
  ],
};

/** The agent's pending resize of the updater. */
const agentsResize: LayoutChange = {
  by: "agent",
  footprint: { d: 2, w: 3 },
  id: "c2",
  kind: "resize",
  reason: "Make room",
  target: { id: "updater", kind: "structure" },
};

/** The minimal map with both changes pending. */
const pendingMap = Effect.gen(function* () {
  const files = yield* minimalMap;

  const proposals = yield* encodeProposals({
    format: 1,
    layout: [engineersMove, agentsResize],
    revision: 2,
  });

  return { ...files, [proposalsFile]: proposals } satisfies HomeFiles;
});

/** The minimal map with both changes already accepted into layout.json. */
const acceptedMap = Effect.gen(function* () {
  const files = yield* minimalMap;
  const saved = yield* decodeLayout(files[layoutFile] ?? "");

  const layout = yield* encodeLayout({
    ...saved,
    structures: {
      gate: { d: 1.5, w: 2, x: 0, y: 2.5 },
      updater: { d: 2, w: 3, x: 0, y: 4 },
    },
  });

  return { ...files, [layoutFile]: layout } satisfies HomeFiles;
});

const runIn = Effect.fnUntraced(function* (
  files: HomeFiles,
  command: string,
  flags: ReadonlyArray<string>
) {
  const home = yield* makeHome(files);

  return yield* runCli(home, [command, mapIn(home, "pipeline").home, ...flags]);
});

/** The report text with the temporary home folder's name taken out. */
const withoutHome = (text: string) =>
  Str.replace(/"home":"[^"]*"/u, '"home":""')(text);

/** The files `export` wrote into the system's folder, by name. */
const exported = (files: HomeFiles, format: string) =>
  Rec.filter(
    files,
    (_content, name) =>
      Str.startsWith("pipeline/pipeline")(name) &&
      Str.endsWith(`.${format}`)(name)
  );

const gateOnUpdater =
  'warning layout.json structures.gate: name tag is drawn on top of "updater".';

describe("check --proposed", () => {
  it.effect(
    "checks the layout with the engineer's and the agent's changes applied",
    () =>
      Effect.gen(function* () {
        const files = yield* pendingMap;
        const result = yield* runIn(files, "check", ["--proposed"]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.include(result.stdout, gateOnUpdater);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("reports the same as checking the accepted changes", () =>
    Effect.gen(function* () {
      const pending = yield* pendingMap;
      const accepted = yield* acceptedMap;
      const flags = ["--proposed", "--json"];
      const proposed = yield* runIn(pending, "check", flags);
      const after = yield* runIn(accepted, "check", ["--json"]);

      assert.strictEqual(proposed.exitCode, 0, proposed.stderr);
      assert.strictEqual(
        withoutHome(proposed.stdout),
        withoutHome(after.stdout)
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("without the flag checks the accepted layout, as before", () =>
    Effect.gen(function* () {
      const files = yield* pendingMap;
      const result = yield* runIn(files, "check", []);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.notInclude(result.stdout, gateOnUpdater);
      assert.include(result.stdout, ": 0 errors, 0 warnings.");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("writes nothing", () =>
    Effect.gen(function* () {
      const files = yield* pendingMap;
      const result = yield* runIn(files, "check", ["--proposed"]);

      assert.strictEqual(result.files[layoutFile], files[layoutFile]);
      assert.strictEqual(result.files[proposalsFile], files[proposalsFile]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("export --proposed", () => {
  for (const format of ["svg", "png", "excalidraw"] as const) {
    it.effect(`draws the ${format} with every open change applied`, () =>
      Effect.gen(function* () {
        const pending = yield* pendingMap;
        const accepted = yield* acceptedMap;
        const flags = ["--format", format];
        const proposed = yield* runIn(pending, "export", [
          ...flags,
          "--proposed",
        ]);
        const after = yield* runIn(accepted, "export", flags);
        const plain = yield* runIn(pending, "export", flags);

        for (const result of [proposed, after, plain]) {
          assert.strictEqual(result.exitCode, 0, result.stderr);
        }

        const drawn = exported(proposed.files, format);

        assert.strictEqual(Arr.length(Rec.keys(drawn)), 1);
        assert.deepStrictEqual(drawn, exported(after.files, format));
        assert.notDeepEqual(drawn, exported(plain.files, format));
      }).pipe(Effect.provide(NodeServices.layer))
    );
  }

  it.effect("reports what export reports for the accepted changes", () =>
    Effect.gen(function* () {
      const pending = yield* pendingMap;
      const accepted = yield* acceptedMap;
      const proposed = yield* runIn(pending, "export", ["--proposed"]);
      const after = yield* runIn(accepted, "export", []);

      assert.strictEqual(proposed.exitCode, 0, proposed.stderr);
      assert.strictEqual(proposed.stderr, after.stderr);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("writes neither layout.json nor proposals.json", () =>
    Effect.gen(function* () {
      const files = yield* pendingMap;
      const result = yield* runIn(files, "export", ["--proposed"]);

      assert.strictEqual(result.files[layoutFile], files[layoutFile]);
      assert.strictEqual(result.files[proposalsFile], files[proposalsFile]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
