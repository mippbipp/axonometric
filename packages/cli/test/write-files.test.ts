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
});
