import { LayoutFile, ProposalsFile } from "@axonometric/contracts";
import type { LayoutChange } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Clock,
  Effect,
  Fiber,
  FileSystem,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { withLock } from "../src/lock.ts";
import { encodeProposals } from "../src/map-files.ts";
import { minimalMap } from "./fixtures.ts";
import {
  homeAt,
  homeKeys,
  makeHome,
  mapIn,
  runCli,
  mapKeys,
} from "./harness.ts";

const { layoutFile, lockFile, proposalsFile } = mapKeys("pipeline");

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

/** Runs `layout` on the minimal map, whose structures are updater and gate. */
const layoutWith = Effect.fnUntraced(function* (
  args: ReadonlyArray<string>,
  files: Readonly<Record<string, string>> = {}
) {
  const home = yield* makeHome({ ...(yield* minimalMap), ...files });

  const result = yield* runCli(home, [
    "layout",
    mapIn(home, "pipeline").home,
    ...args,
  ]);

  return { home, result };
});

const savedLayout = Effect.fnUntraced(function* (
  files: Readonly<Partial<Record<string, string>>>
) {
  return yield* decodeLayout(files[layoutFile] ?? "");
});

/** Changes with their ids left out: the CLI makes them at random. */
const withoutIds = (changes: ReadonlyArray<LayoutChange>) =>
  Arr.map(changes, ({ id: _, ...rest }) => rest);

/** A change as `withoutIds` gives it. */
type Unnamed = ReturnType<typeof withoutIds>[number];

const savedProposals = Effect.fnUntraced(function* (
  files: Readonly<Partial<Record<string, string>>>
) {
  return yield* decodeProposals(files[proposalsFile] ?? "");
});

/**
 * A lock file as another `axonometric` process would write it.
 */
const lockOf = (pid: number) =>
  JSON.stringify({
    command: "serve",
    pid,
    since: "2026-10-31T09:00:00.000Z",
  });

/**
 * Starts a child process that idles until the scope closes, so its PID
 * belongs to a live process that isn't this one.
 */
const liveProcess = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"])
  );

  return Number(handle.pid);
}).pipe(Effect.provide(NodeServices.layer));

/**
 * A PID no process has or will have. A real process's PID won't do: Windows
 * hands a freed PID to the next process it starts, so the "dead" process
 * could be running again by the time the lock is checked.
 */
const deadPid = Effect.succeed(2 ** 31 - 1);

describe("layout", () => {
  it.effect("moves a structure, bumps the revision and prints the change", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "8", "--y", "0.5"]);
      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(layout.structures.gate, {
        d: 1.5,
        w: 2,
        x: 8,
        y: 0.5,
      });
      assert.deepStrictEqual(layout.structures.updater, {
        d: 2,
        w: 2,
        x: 0,
        y: 4,
      });
      assert.strictEqual(layout.revision, 1);
      assert.strictEqual(
        result.stdout,
        "gate: x 4 → 8, y 0 → 0.5. layout.json is at revision 1.\n"
      );
      assert.isUndefined(result.files[lockFile]);
    })
  );

  it.effect("resizes a structure's footprint", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith([
        "updater",
        "--w",
        "3",
        "--d",
        "2.5",
      ]);

      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(layout.structures.updater, {
        d: 2.5,
        w: 3,
        x: 0,
        y: 4,
      });
      assert.include(result.stdout, "updater: w 2 → 3, d 2 → 2.5.");
    })
  );

  it.effect("places a structure that has no position yet", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "6", "--y", "0"], {
        [layoutFile]: '{ "format": 1, "revision": 2, "structures": {} }',
      });

      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(layout.structures, {
        gate: { d: 2, w: 2, x: 6, y: 0 },
      });
      assert.strictEqual(layout.revision, 3);
      assert.include(result.stdout, "gate: placed at x 6, y 0, w 2, d 2.");
    })
  );

  it.effect("says so when nothing changes, and writes nothing", () =>
    Effect.gen(function* () {
      const before = yield* minimalMap;
      const { result } = yield* layoutWith(["gate", "--x", "4"]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
      assert.include(
        result.stdout,
        "gate: already at x 4, y 0, w 2, d 1.5. Nothing changed."
      );
    })
  );

  it.effect("rejects an unknown structure, listing the valid ids", () =>
    Effect.gen(function* () {
      const before = yield* minimalMap;
      const { result } = yield* layoutWith(["gates", "--x", "4"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'No structure in data.mjs has the id "gates". Use one of: updater, gate.'
      );
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
    })
  );

  it.effect("rejects a position that isn't on a half unit", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "4.25"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        "--x 4.25 isn't on the half-unit grid. Use a whole or half unit, such as 4 or 4.5."
      );
    })
  );

  it.effect("rejects a footprint of zero", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--w", "0"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        "--w 0 is too small. A footprint is at least half a unit"
      );
    })
  );

  it.effect("rejects a footprint that overlaps another structure", () =>
    Effect.gen(function* () {
      const before = yield* minimalMap;
      const { result } = yield* layoutWith(["gate", "--x", "1", "--y", "3"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'gate at x 1, y 3, w 2, d 1.5 would overlap "updater" at x 0, y 4, w 2, d 2. Pick a free spot.'
      );
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
    })
  );

  it.effect("asks for at least one of --x, --y, --w and --d", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        "Give at least one of --x, --y, --w and --d."
      );
    })
  );

  it.effect("needs --x and --y to place a structure with no position", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "6"], {
        [layoutFile]: '{ "format": 1, "revision": 0, "structures": {} }',
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        '"gate" has no position yet. Give both --x and --y to place it, or run axonometric build to place it automatically.'
      );
    })
  );

  it.effect("saves a route override for a hop, and bumps the revision", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith([
        "--hop",
        "h-update",
        "--route",
        "2,5 3,5 3,1 4,1",
      ]);

      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(layout.routes, {
        "h-update": [
          { x: 2, y: 5 },
          { x: 3, y: 5 },
          { x: 3, y: 1 },
          { x: 4, y: 1 },
        ],
      });
      assert.strictEqual(layout.revision, 1);
      assert.strictEqual(layout.structures.gate?.x, 4);
      assert.include(result.stdout, "h-update: route saved through 2,5 3,5");
      assert.include(result.stdout, "layout.json is at revision 1.");
      assert.isUndefined(result.files[lockFile]);
    })
  );

  it.effect("clears a hop's route override with --route auto", () =>
    Effect.gen(function* () {
      const saved = yield* layoutWith([
        "--hop",
        "h-update",
        "--route",
        "2,5 3,5 3,1 4,1",
      ]);

      const { result } = yield* layoutWith(
        ["--hop", "h-update", "--route", "auto"],
        { [layoutFile]: saved.result.files[layoutFile] ?? "" }
      );

      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.isUndefined(layout.routes);
      assert.strictEqual(layout.revision, 2);
      assert.include(result.stdout, "h-update: route override cleared");
    })
  );

  it.effect("says so when --route auto has nothing to clear", () =>
    Effect.gen(function* () {
      const before = yield* minimalMap;

      const { result } = yield* layoutWith([
        "--hop",
        "h-update",
        "--route",
        "auto",
      ]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
      assert.include(result.stdout, "already routes itself. Nothing changed.");
    })
  );

  it.effect.each([
    [
      "a route that doesn't start on the source's edge",
      "3,5 3,1 4,1",
      "starts at 3,5, which isn't on the edge of \"updater\" at x 0–2, y 4–6. Start on that footprint's edge.",
    ],
    [
      "a route that doesn't end on the target's edge",
      "2,5 3,5 3,1",
      "ends at 3,1, which isn't on the edge of \"gate\" at x 4–6, y 0–1.5. End on that footprint's edge.",
    ],
    [
      "a route with a diagonal leg",
      "2,5 4,1",
      "runs diagonally from 2,5 to 4,1. Every leg must run along x or y, so add a corner point that shares x with one and y with the other, such as 2,1.",
    ],
    ["a route of one point", "2,5", "needs at least two points"],
    ["a point that isn't x,y", "2,5 oops", 'point "oops" isn\'t x,y.'],
    [
      "a point off the half-unit grid",
      "2,5 2.25,5",
      "2.25,5 isn't on the half-unit grid.",
    ],
  ] as const)("refuses %s, and writes nothing", ([, route, message]) =>
    Effect.gen(function* () {
      const before = yield* minimalMap;

      const { result } = yield* layoutWith([
        "--hop",
        "h-update",
        "--route",
        route,
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, message);
      assert.include(result.stderr, "layout wrote nothing.");
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
    })
  );

  it.effect("refuses an unknown hop, listing the valid ids", () =>
    Effect.gen(function* () {
      const before = yield* minimalMap;

      const { result } = yield* layoutWith([
        "--hop",
        "h-nope",
        "--route",
        "2,5 3,5 3,1 4,1",
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'No hop in data.mjs has the id "h-nope". Use one of: h-update.'
      );
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
    })
  );

  it.effect.each([
    [["--hop", "h-update"], "Rerouting needs both --hop and --route."],
    [["--route", "auto"], "Rerouting needs both --hop and --route."],
    [
      ["gate", "--hop", "h-update", "--route", "auto"],
      "Rerouting a hop takes --hop and --route alone.",
    ],
    [[], "Name a structure to move or resize, or give --hop and --route"],
  ] as const)("refuses the arguments %j", ([args, message]) =>
    Effect.gen(function* () {
      const before = yield* minimalMap;
      const { result } = yield* layoutWith(args);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, message);
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
    })
  );

  it.effect.each([
    ["layout", ["gate", "--x", "8"]],
    ["export", ["--format", "excalidraw"]],
  ] as const)(
    "%s refuses a map with errors, and writes nothing",
    ([command, args]) =>
      Effect.gen(function* () {
        const files = {
          ...(yield* minimalMap),
          [mapKeys("pipeline").dataFile]: "export default {",
        };

        const home = yield* makeHome(files);

        const result = yield* runCli(home, [
          command,
          mapIn(home, "pipeline").home,
          ...args,
        ]);

        assert.strictEqual(result.exitCode, 1);
        assert.include(result.stderr, `${command} wrote nothing.`);
        assert.deepStrictEqual(
          Rec.filter(
            result.files,
            (_, name) => !Str.startsWith(mapKeys("pipeline").stateFolder)(name)
          ),
          files
        );
      })
  );

  it.live(
    "waits for a lock held by a live process, then fails naming it",
    () =>
      Effect.gen(function* () {
        const pid = yield* liveProcess;
        const before = yield* minimalMap;
        const started = yield* Clock.currentTimeMillis;

        const { result } = yield* layoutWith(["gate", "--x", "8"], {
          [lockFile]: lockOf(pid),
        });

        assert.strictEqual(result.exitCode, 1);
        assert.isAtLeast((yield* Clock.currentTimeMillis) - started, 4000);
        assert.include(result.stderr, `layout could not take the lock on`);
        assert.include(
          result.stderr,
          `process ${pid} (serve) has held it since 2026-10-31T09:00:00.000Z.`
        );
        assert.strictEqual(result.files[layoutFile], before[layoutFile]);
        assert.strictEqual(result.files[lockFile], lockOf(pid));
      }).pipe(Effect.scoped),
    15_000
  );

  it.effect("removes a lock left by a process that has exited", () =>
    Effect.gen(function* () {
      const pid = yield* deadPid;

      const { result } = yield* layoutWith(["gate", "--x", "8"], {
        [lockFile]: lockOf(pid),
      });

      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.strictEqual(layout.structures.gate?.x, 8);
      assert.isUndefined(result.files[lockFile]);
    })
  );

  it.effect("removes a lock that was left half written", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "8"], {
        [lockFile]: '{ "pid": ',
      });

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.isUndefined(result.files[lockFile]);
    })
  );

  it.effect("releases the lock when the command fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const minimalMapFiles = yield* minimalMap;
      const home = yield* makeHome(minimalMapFiles);
      const map = mapIn(home, "pipeline");

      // A folder where layout.json goes makes the command fail after it
      // has taken the lock.
      yield* fs.remove(map.layoutFile);
      yield* fs.makeDirectory(map.layoutFile);

      const result = yield* runCli(home, [
        "layout",
        map.home,
        "gate",
        "--x",
        "8",
        "--y",
        "0",
      ]);

      assert.notStrictEqual(result.exitCode, 0);
      const lockExists = yield* fs.exists(map.lockFile);
      assert.isFalse(lockExists);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "stops waiting for a held lock as soon as it's interrupted",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pid = yield* liveProcess;
        const home = yield* makeHome({ [homeKeys.lockFile]: lockOf(pid) });
        const paths = homeAt(home);

        const waiting = yield* withLock(paths, "layout").pipe(
          Effect.scoped,
          Effect.forkChild
        );

        yield* Effect.sleep("300 millis");

        const started = yield* Clock.currentTimeMillis;

        yield* Fiber.interrupt(waiting);

        assert.isBelow((yield* Clock.currentTimeMillis) - started, 1000);
        const lockText = yield* fs.readFileString(paths.lockFile);
        assert.strictEqual(lockText, lockOf(pid));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    15_000
  );
});

/** An engineer's pending move of gate, as the page saves it. */
const engineersGate: LayoutChange = {
  by: "engineer",
  id: "c3",
  kind: "move",
  moves: [
    { position: { x: 8, y: 0 }, target: { id: "gate", kind: "structure" } },
  ],
};

/** Runs `layout ... --propose --reason <reason>` on the minimal map. */
const proposeWith = (
  args: ReadonlyArray<string>,
  files: Readonly<Record<string, string>> = {}
) => layoutWith([...args, "--propose", "--reason", "Tidy the row"], files);

describe("layout --propose", () => {
  it.effect.each<
    readonly [string, ReadonlyArray<string>, ReadonlyArray<Unnamed>, string]
  >([
    [
      "a move",
      ["gate", "--x", "8"],
      [
        {
          by: "agent",
          kind: "move",
          moves: [
            {
              position: { x: 8, y: 0 },
              target: { id: "gate", kind: "structure" },
            },
          ],
          reason: "Tidy the row",
        },
      ],
      'gate: proposed x 4 → 8, for "Tidy the row". proposals.json is at revision 1.',
    ],
    [
      "a resize",
      ["gate", "--w", "3"],
      [
        {
          by: "agent",
          footprint: { d: 1.5, w: 3 },
          kind: "resize",
          reason: "Tidy the row",
          target: { id: "gate", kind: "structure" },
        },
      ],
      'gate: proposed w 2 → 3, for "Tidy the row". proposals.json is at revision 1.',
    ],
    [
      "a reroute",
      ["--hop", "h-update", "--route", "2,5 3,5 3,1 4,1"],
      [
        {
          by: "agent",
          kind: "reroute",
          points: [
            { x: 2, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 1 },
            { x: 4, y: 1 },
          ],
          reason: "Tidy the row",
          target: { id: "h-update", kind: "hop" },
        },
      ],
      'h-update: proposed route through 2,5 3,5 3,1 4,1, for "Tidy the row". proposals.json is at revision 1.',
    ],
  ])(
    "writes %s to proposals.json as the agent's, and leaves layout.json as it was",
    ([, args, changes, line]) =>
      Effect.gen(function* () {
        const before = yield* minimalMap;
        const { result } = yield* proposeWith(args);
        const proposals = yield* savedProposals(result.files);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.deepStrictEqual(withoutIds(proposals.layout), changes);
        assert.strictEqual(proposals.revision, 1);
        assert.strictEqual(result.files[layoutFile], before[layoutFile]);
        assert.include(result.stdout, line);
        assert.include(
          result.stdout,
          "The engineer accepts or discards it in the Pending tab."
        );
        assert.isUndefined(result.files[lockFile]);
      })
  );

  it.effect(
    "proposes automatic routing for a hop with an accepted override",
    () =>
      Effect.gen(function* () {
        const routed = yield* layoutWith([
          "--hop",
          "h-update",
          "--route",
          "2,5 3,5 3,1 4,1",
        ]);

        const accepted = routed.result.files[layoutFile] ?? "";

        const { result } = yield* proposeWith(
          ["--hop", "h-update", "--route", "auto"],
          { [layoutFile]: accepted }
        );

        const proposals = yield* savedProposals(result.files);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.deepStrictEqual(withoutIds(proposals.layout), [
          {
            by: "agent",
            kind: "reroute",
            points: null,
            reason: "Tidy the row",
            target: { id: "h-update", kind: "hop" },
          },
        ]);
        assert.strictEqual(result.files[layoutFile], accepted);
        assert.include(result.stdout, "h-update: proposed automatic routing");
      })
  );

  it.effect(
    "replaces the agent's earlier proposal for the same structure",
    () =>
      Effect.gen(function* () {
        const first = yield* proposeWith(["gate", "--x", "8"]);

        const { result } = yield* layoutWith(
          ["gate", "--y", "2.5", "--propose", "--reason", "Make room"],
          { [proposalsFile]: first.result.files[proposalsFile] ?? "" }
        );

        const proposals = yield* savedProposals(result.files);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.deepStrictEqual(withoutIds(proposals.layout), [
          {
            by: "agent",
            kind: "move",
            moves: [
              {
                position: { x: 8, y: 2.5 },
                target: { id: "gate", kind: "structure" },
              },
            ],
            reason: "Make room",
          },
        ]);
        assert.strictEqual(proposals.revision, 2);
      })
  );

  it.effect(
    "refuses a structure the engineer has pending, naming their change, and writes nothing",
    () =>
      Effect.gen(function* () {
        const before = yield* minimalMap;

        const pending = yield* encodeProposals({
          format: 1,
          layout: [engineersGate],
          revision: 4,
        });

        const { result } = yield* proposeWith(["gate", "--w", "3"], {
          [proposalsFile]: pending,
        });

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stderr,
          'The engineer has a pending move of "gate" (change c3). Propose changes to other structures, or wait until they accept or discard change c3. layout wrote nothing.'
        );
        assert.strictEqual(result.files[proposalsFile], pending);
        assert.strictEqual(result.files[layoutFile], before[layoutFile]);
      })
  );

  it.effect.each([
    [["gate", "--x", "8", "--propose"], "--propose needs --reason"],
    [["gate", "--x", "8", "--reason", "Tidy"], "--reason goes with --propose."],
    [["gate", "--x", "8", "--propose", "--reason", "  "], "--reason is empty."],
    [
      ["gate", "--x", "8", "--propose", "--reason", Str.repeat(1001)("x")],
      "The reason is 1001 characters, over the limit of 1000.",
    ],
    [
      ["gate", "--propose", "--reason", "Tidy"],
      "Give at least one of --x, --y, --w and --d.",
    ],
  ] as const)("refuses %j and writes nothing", ([args, message]) =>
    Effect.gen(function* () {
      const before = yield* minimalMap;
      const { result } = yield* layoutWith(args);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, message);
      assert.include(result.stderr, "layout wrote nothing.");
      assert.strictEqual(result.files[layoutFile], before[layoutFile]);
      assert.isUndefined(result.files[proposalsFile]);
    })
  );

  it.effect("prints the drawing warnings of the proposed layout", () =>
    Effect.gen(function* () {
      // Gate just above the updater puts gate's name tag on it.
      const { result } = yield* proposeWith(["gate", "--x", "0", "--y", "2.5"]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.include(
        result.stderr,
        'warning layout.json structures.gate: name tag is drawn on top of "updater".'
      );
    })
  );
});
