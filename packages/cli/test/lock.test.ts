import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Option,
  Path,
  PlatformError,
} from "effect";

import { attempt, readLock } from "../src/lock.ts";
import { makeHome } from "./harness.ts";

const platformError = (_tag: "NotFound" | "PermissionDenied") =>
  // @effect-diagnostics-next-line unstableApiUsage:off
  PlatformError.systemError({
    _tag,
    method: "readFileString",
    module: "FileSystem",
    pathOrDescriptor: "lock",
  });

const denied = () => platformError("PermissionDenied");

const gone = () => platformError("NotFound");

/** A file system whose first `failures` reads are denied, then return `text`. */
const deniedThenReadable = (failures: number, text: string) => {
  let reads = 0;

  const fs = FileSystem.makeNoop({
    readFileString: () =>
      Effect.suspend(() => {
        reads += 1;

        return reads <= failures ? Effect.fail(denied()) : Effect.succeed(text);
      }),
  });

  return { fs, reads: () => reads };
};

describe("reading the lock file", () => {
  it.live("retries a denied read on Windows until the file is readable", () =>
    Effect.gen(function* () {
      const { fs, reads } = deniedThenReadable(2, "held");

      const text = yield* readLock("lock", "win32").pipe(
        Effect.provideService(FileSystem.FileSystem, fs)
      );

      assert.deepStrictEqual(text, Option.some("held"));
      assert.strictEqual(reads(), 3);
    })
  );

  it.live("treats a file that vanishes during the retries as no lock", () =>
    Effect.gen(function* () {
      let reads = 0;
      const fs = FileSystem.makeNoop({
        readFileString: () =>
          Effect.suspend(() => {
            reads += 1;

            return Effect.fail(reads === 1 ? denied() : gone());
          }),
      });

      const text = yield* readLock("lock", "win32").pipe(
        Effect.provideService(FileSystem.FileSystem, fs)
      );

      assert.deepStrictEqual(text, Option.none());
    })
  );

  it.live("fails a denied read on other systems without retrying", () =>
    Effect.gen(function* () {
      const { fs, reads } = deniedThenReadable(2, "held");

      const exit = yield* readLock("lock", "linux").pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.exit
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(reads(), 1);
    })
  );

  it.live("gives up on Windows when the read stays denied", () =>
    Effect.gen(function* () {
      const { fs, reads } = deniedThenReadable(Infinity, "held");

      const exit = yield* readLock("lock", "win32").pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.exit
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.isAbove(reads(), 1);
    })
  );
});

/**
 * A pid no process can have: above the 2^22 that Linux allows and the 2^15
 * that macOS does, and not what Windows hands out in practice.
 */
const deadPid = 2_000_000_000;

const holderOf = (command: string, pid = process.pid) =>
  JSON.stringify({ command, pid, since: "2026-01-01T00:00:00.000Z" });

describe("clearing a stale lock", () => {
  it.live("lets one of two commands that find the same stale lock win", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* makeHome({});
      const file = path.join(home, "lock");

      yield* fs.writeFileString(file, holderOf("dead", deadPid));

      const outcomes = yield* Effect.all(
        [attempt(file, holderOf("first")), attempt(file, holderOf("second"))],
        { concurrency: "unbounded" }
      );

      const winners = Arr.filter(outcomes, Option.isNone);
      const losers = Arr.filter(outcomes, Option.isSome);

      assert.strictEqual(winners.length, 1);
      assert.strictEqual(losers.length, 1);

      const text = yield* readLock(file);
      const names = Arr.map(["first", "second"], (name) => holderOf(name));

      assert.isTrue(Option.isSome(text) && names.includes(text.value));
      const value_1 = yield* fs.exists(`${file}.takeover`);
      assert.isFalse(value_1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "lets only one command win when one stalls between reading the stale lock and removing it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* makeHome({});
        const file = path.join(home, "lock");

        yield* fs.writeFileString(file, holderOf("dead", deadPid));

        const resume = yield* Deferred.make<string>();
        let reads = 0;

        // The slow command stalls after its second read of the lock, so the
        // quick command clears the lock and takes a fresh one in the gap.
        const stalled: FileSystem.FileSystem = {
          ...fs,
          readFileString: (name, encoding) =>
            fs.readFileString(name, encoding).pipe(
              Effect.tap(() => {
                reads += 1;

                return reads === 2 ? Deferred.await(resume) : Effect.void;
              })
            ),
        };

        const slow = yield* attempt(file, holderOf("slow")).pipe(
          Effect.provideService(FileSystem.FileSystem, stalled),
          Effect.forkChild
        );

        yield* Effect.sleep("50 millis");

        const quick = yield* attempt(file, holderOf("quick")).pipe(
          Effect.forkChild
        );

        yield* Effect.sleep("50 millis");
        yield* Deferred.succeed(resume, "go");

        const outcomes = [yield* Fiber.join(slow), yield* Fiber.join(quick)];

        assert.strictEqual(Arr.filter(outcomes, Option.isNone).length, 1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
