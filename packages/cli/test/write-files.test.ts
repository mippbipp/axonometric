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

        yield* writeAll([{ content: "new", file }]);

        const fileText = yield* fs.readFileString(file);
        assert.strictEqual(fileText, "new");
        const tmpExists = yield* fs.exists(`${file}.${process.pid}.tmp`);
        assert.isFalse(tmpExists);
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
          { content: "new one", file: one },
          { content: "new two", file: two },
          { content: "new three", file: three },
        ]).pipe(
          Effect.provideService(FileSystem.FileSystem, failing),
          Effect.exit
        );

        assert.isTrue(Exit.isFailure(exit));
        const oneText = yield* fs.readFileString(one);
        assert.strictEqual(oneText, "old one");
        const twoExists = yield* fs.exists(two);
        assert.isFalse(twoExists);
        const threeExists = yield* fs.exists(three);
        assert.isFalse(threeExists);
        const entries = yield* fs.readDirectory(home);
        assert.sameMembers(entries, ["one.json"]);
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
        { content: "new a", file: a },
        { content: "new b", exclusive: true, file: b },
      ]).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      const aText = yield* fs.readFileString(a);
      assert.strictEqual(aText, "old a");
      const bText = yield* fs.readFileString(b);
      assert.strictEqual(bText, "old b");
      const entries = yield* fs.readDirectory(home);
      assert.sameMembers(entries, ["a.json", "b.json"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
