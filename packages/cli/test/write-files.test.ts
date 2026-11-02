import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Exit, FileSystem, Path, Scope } from "effect";

import { writeAll } from "../src/write-files.ts";
import { makeHome } from "./harness.ts";

describe("writing outputs", () => {
  // Windows refuses to rename over a file that is open elsewhere. Other
  // systems allow it, so there's nothing to retry there.
  it.live.skipIf(process.platform !== "win32")(
    "waits for a target held open elsewhere",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* makeHome({});
        const file = path.join(home, "held.json");

        yield* fs.writeFileString(file, "old");

        const holder = yield* Scope.make();

        yield* fs.open(file, { flag: "r" }).pipe(Scope.provide(holder));

        yield* Effect.sleep(Duration.millis(50)).pipe(
          Effect.andThen(Scope.close(holder, Exit.void)),
          Effect.forkScoped
        );

        yield* writeAll([{ file, content: "new" }]);

        assert.strictEqual(yield* fs.readFileString(file), "new");
        assert.isFalse(yield* fs.exists(`${file}.${process.pid}.tmp`));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    10_000
  );

  it.live(
    "puts back the files already renamed when a later rename fails, and removes temporaries",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* makeHome({ "one.json": "old one" });
        const one = path.join(home, "one.json");
        const two = path.join(home, "two.json");
        const three = path.join(home, "three.json");

        // A real failed rename gives a real PlatformError to fail with.
        const refused = yield* fs
          .rename(path.join(home, "missing"), path.join(home, "nowhere", "x"))
          .pipe(Effect.flip);

        // The third output's rename fails, after the first two went through.
        const failing: FileSystem.FileSystem = {
          ...fs,
          rename: (from, to) =>
            to === three ? Effect.fail(refused) : fs.rename(from, to),
        };

        const exit = yield* writeAll([
          { file: one, content: "new one" },
          { file: two, content: "new two" },
          { file: three, content: "new three" },
        ]).pipe(
          Effect.provideService(FileSystem.FileSystem, failing),
          Effect.exit
        );

        assert.isTrue(Exit.isFailure(exit));
        assert.strictEqual(yield* fs.readFileString(one), "old one");
        assert.isFalse(yield* fs.exists(two));
        assert.isFalse(yield* fs.exists(three));
        assert.sameMembers(yield* fs.readDirectory(home), ["one.json"]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("refuses an exclusive output that exists, and changes nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* makeHome({ "a.json": "old a", "b.json": "old b" });
      const a = path.join(home, "a.json");
      const b = path.join(home, "b.json");

      const exit = yield* writeAll([
        { file: a, content: "new a" },
        { file: b, content: "new b", exclusive: true },
      ]).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(yield* fs.readFileString(a), "old a");
      assert.strictEqual(yield* fs.readFileString(b), "old b");
      assert.sameMembers(yield* fs.readDirectory(home), ["a.json", "b.json"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
