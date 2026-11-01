import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Argument, CliError, Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { starterData } from "./starter.ts";

/** The home folder already has a map, and `init` never overwrites one. */
export class MapExists extends Schema.TaggedError<
  MapExists,
  { readonly brand: unique symbol }
>()("MapExists", { file: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `${this.file} already exists. init never overwrites a map; edit it, or pick another home folder.`;
  }
}

/**
 * Whether git ignores `folder`. None when git isn't installed or the folder
 * isn't in a git repo. `git check-ignore` exits 0 for an ignored path, 1 for
 * one that isn't, and 128 outside a repo.
 */
const gitIgnores = Effect.fnUntraced(function* (folder: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exitCode = yield* spawner
    .exitCode(
      ChildProcess.make("git", ["check-ignore", "--quiet", folder], {
        cwd: folder,
        stdout: "ignore",
        stderr: "ignore",
      })
    )
    .pipe(Effect.asSome, Effect.orElseSucceed(Option.none));

  return Option.flatMap(exitCode, (code) => {
    if (code === 0) {
      return Option.some(true);
    }

    return code === 1 ? Option.some(false) : Option.none();
  });
});

/** The `.scratch` folder that `home` is in, if it's in one. */
const scratchFolder = Effect.fnUntraced(function* (home: string) {
  const path = yield* Path.Path;
  let folder = home;

  while (path.dirname(folder) !== folder) {
    if (path.basename(folder) === ".scratch") {
      return Option.some(folder);
    }

    folder = path.dirname(folder);
  }

  return Option.none<string>();
});

const init = Effect.fn("init")(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(home);
  const file = path.join(absolute, "data.mjs");

  yield* fs.makeDirectory(absolute, { recursive: true });

  // "wx" fails when the file exists, so a map written meanwhile survives.
  yield* fs
    .writeFileString(file, starterData, { flag: "wx" })
    .pipe(
      Effect.catchReason("PlatformError", "AlreadyExists", () =>
        Effect.fail(MapExists.make({ file }))
      )
    );

  yield* Console.log(
    `Wrote ${file}. Edit it to describe your system, then run axonometric build ${home} to place the structures and write SYSTEM.md and the page.`
  );

  const scratch = yield* scratchFolder(absolute);

  if (Option.isSome(scratch)) {
    const ignored = yield* gitIgnores(absolute);

    if (Option.contains(ignored, false)) {
      yield* Console.error(
        `warning: ${home} is under a .scratch/ folder that git doesn't ignore, so the map would be committed. Add .scratch/ to the repo's .gitignore.`
      );
    }
  }
});

export const initCommand = Command.make(
  "init",
  {
    home: Argument.Directory("home").pipe(
      Argument.withDescription(
        "The folder to create the map in, such as .scratch/<system>/map or docs/<system>/map"
      )
    ),
  },
  ({ home }) => init(home)
).pipe(
  Command.withDescription(
    "Write a starter data.mjs. Refuses to overwrite a map, and warns when a .scratch/ home isn't ignored by git."
  )
);
