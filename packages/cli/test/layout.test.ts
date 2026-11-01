import { LayoutFile } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Clock, Effect, Fiber, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { withLock } from "../src/lock.ts";
import { minimalMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

const layoutFile = "pipeline/map/layout.json";

const lockFile = "pipeline/map/.axonometric/lock";

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

/** Runs `layout` on the minimal map, whose structures are updater and gate. */
const layoutWith = Effect.fnUntraced(function* (
  args: readonly string[],
  files: Readonly<Record<string, string>> = {}
) {
  const home = yield* makeHome({ ...(yield* minimalMap), ...files });

  const result = yield* runCli(home, [
    "layout",
    `${home}/pipeline/map`,
    ...args,
  ]);

  return { home, result };
});

const savedLayout = Effect.fnUntraced(function* (
  files: Readonly<Partial<Record<string, string>>>
) {
  return yield* decodeLayout(files[layoutFile] ?? "");
});

/**
 * A lock file as another `axonometric` process would write it.
 */
const lockOf = (pid: number) =>
  JSON.stringify({
    pid,
    command: "serve",
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

/** The PID of a process that has exited. */
const deadPid = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, ["-e", ""])
  );

  yield* handle.exitCode;

  return Number(handle.pid);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("layout", () => {
  it.effect("moves a structure, bumps the revision and prints the change", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "8", "--y", "0.5"]);
      const layout = yield* savedLayout(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(layout.structures.gate, {
        x: 8,
        y: 0.5,
        w: 2,
        d: 1.5,
      });
      assert.deepStrictEqual(layout.structures.updater, {
        x: 0,
        y: 4,
        w: 2,
        d: 2,
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
        x: 0,
        y: 4,
        w: 3,
        d: 2.5,
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
        gate: { x: 6, y: 0, w: 2, d: 2 },
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

  it.effect("refuses to change a map with errors", () =>
    Effect.gen(function* () {
      const { result } = yield* layoutWith(["gate", "--x", "8"], {
        "pipeline/map/data.mjs": "export default {",
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "layout wrote nothing.");
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
      const path = yield* Path.Path;
      const home = yield* makeHome(yield* minimalMap);
      const map = path.join(home, "pipeline", "map");
      const lock = path.join(map, ".axonometric", "lock");

      // A folder where layout.json goes makes the command fail after it
      // has taken the lock.
      yield* fs.remove(path.join(map, "layout.json"));
      yield* fs.makeDirectory(path.join(map, "layout.json"));

      const result = yield* runCli(home, [
        "layout",
        map,
        "gate",
        "--x",
        "8",
        "--y",
        "0",
      ]);

      assert.notStrictEqual(result.exitCode, 0);
      assert.isFalse(yield* fs.exists(lock));
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "stops waiting for a held lock as soon as it's interrupted",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const pid = yield* liveProcess;
        const home = yield* makeHome({ ".axonometric/lock": lockOf(pid) });
        const lock = path.join(home, ".axonometric", "lock");

        const waiting = yield* withLock(home, "layout").pipe(
          Effect.scoped,
          Effect.forkChild
        );

        yield* Effect.sleep("300 millis");

        const started = yield* Clock.currentTimeMillis;

        yield* Fiber.interrupt(waiting);

        assert.isBelow((yield* Clock.currentTimeMillis) - started, 1000);
        assert.strictEqual(yield* fs.readFileString(lock), lockOf(pid));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    15_000
  );
});
