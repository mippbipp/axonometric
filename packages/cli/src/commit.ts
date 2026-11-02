import { Console, Effect, Path } from "effect";
import type { Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { commitOldestBatch } from "./commit-writes.ts";

const commit = Effect.fn("commit")(function* (
  home: string,
  message: Option.Option<string>
) {
  const path = yield* Path.Path;
  const done = yield* commitOldestBatch(home, message);

  return yield* Console.log(
    `Committed batch ${done.batch.number} as revision ${done.revision}: ${done.accepted} accepted, ${done.changed} changed, ${done.rejected} rejected. Rebuilt ${path.dirname(path.resolve(home))}; open pages update on their own.`
  );
});

export const commitCommand = Command.make(
  "commit",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and proposals.json"
      )
    ),
    message: Flag.String("message").pipe(
      Flag.optional,
      Flag.withDescription(
        "The revision's message. Without it, commit writes one from the verdicts."
      )
    ),
  },
  ({ home, message }) => commit(home, message)
).pipe(
  Command.withDescription(
    "Commit the oldest batch that has no commit: refuses while an item has no verdict, validates data.mjs, applies the accepted and changed layout changes to layout.json, saves a revision with the reasons, and rebuilds SYSTEM.md and the page. Open pages update on their own."
  )
);
