// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vitest decides skips before any test runs, so the git check calls spawnSync from node:child_process outside Effect
import { spawnSync } from "node:child_process";

import { NodeServices } from "@effect/platform-node";
import { Effect, String as Str } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * Whether git is missing. Tests that need a real repo skip without it.
 * Vitest decides skips before any test runs, so this check is synchronous.
 */
// oxlint-disable-next-line node/no-sync -- a skip is decided before any test runs, so the git check cannot be an Effect
export const noGit = spawnSync("git", ["--version"]).error !== undefined;

/** Runs git in `cwd` and returns its trimmed output. */
export const git = Effect.fnUntraced(function* (
  cwd: string,
  args: ReadonlyArray<string>
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const output = yield* spawner.string(
    ChildProcess.make("git", args, { cwd, stdin: "ignore" })
  );

  return Str.trim(output);
}, Effect.provide(NodeServices.layer));

/**
 * Makes `folder` a git repo on branch main, with a local author so commits
 * work on a machine with no git identity.
 */
export const initRepo = Effect.fnUntraced(function* (folder: string) {
  yield* git(folder, ["init", "--quiet", "--initial-branch=main"]);
  yield* git(folder, ["config", "user.name", "Test"]);
  yield* git(folder, ["config", "user.email", "test@example.com"]);
  yield* git(folder, ["config", "commit.gpgsign", "false"]);
});

/** Commits everything in `home` and returns the commit's hash. */
export const commitAll = Effect.fnUntraced(function* (
  home: string,
  message: string
) {
  yield* git(home, ["add", "--all"]);
  yield* git(home, ["commit", "--quiet", "--no-verify", "-m", message]);

  return yield* git(home, ["rev-parse", "HEAD"]);
});
