import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Option, PlatformError } from "effect";

import { readLock } from "../src/lock.ts";

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
