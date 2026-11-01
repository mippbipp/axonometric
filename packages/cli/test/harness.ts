import { NodeServices } from "@effect/platform-node";
import { assert } from "@effect/vitest";
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Runtime,
  Stdio,
  String as Str,
} from "effect";
import { TerminalCapabilities } from "effect/cli";

import { run } from "../src/cli.ts";
import { openPage } from "./browser.ts";

/** Files keyed by their `/`-separated path relative to the home folder. */
export type HomeFiles = Readonly<Partial<Record<string, string>>>;

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every file in the home folder after the run. */
  readonly files: HomeFiles;
}

const plainTerminal: TerminalCapabilities.TerminalCapabilities = {
  canColor: false,
  canAnimate: false,
  canPrompt: false,
};

const formatLine = (args: readonly unknown[]) =>
  `${Arr.join(Arr.map(args, String), " ")}\n`;

const captureConsole = () => {
  const output = { stdout: "", stderr: "" };

  const console: Console.Console = {
    ...globalThis.console,
    log: (...args: readonly unknown[]) => {
      output.stdout += formatLine(args);
    },
    error: (...args: readonly unknown[]) => {
      output.stderr += formatLine(args);
    },
  };

  return { console, output };
};

const readFiles = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: Partial<Record<string, string>> = {};
  const entries = yield* fs.readDirectory(home, { recursive: true });

  for (const entry of entries) {
    const absolute = path.join(home, entry);
    const info = yield* fs.stat(absolute);

    if (info.type === "File") {
      const key = Arr.join(Str.split(entry, path.sep), "/");
      files[key] = yield* fs.readFileString(absolute);
    }
  }

  return files;
});

/**
 * Creates a temporary home folder holding `files`, removed when the test's
 * scope closes.
 */
export const makeHome = Effect.fnUntraced(function* (files: HomeFiles) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "axonometric-" });

  for (const [name, content = ""] of Rec.toEntries(files)) {
    const absolute = path.join(home, ...Str.split(name, "/"));

    yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
    yield* fs.writeFileString(absolute, content);
  }

  return home;
}, Effect.provide(NodeServices.layer));

/**
 * Runs the CLI in-process with `args`. `home` is only used afterwards, to
 * read back every file in it; it is not passed to the CLI. Pass `home` inside
 * `args` for commands that take one. Returns the exit code, the captured
 * output and those files.
 */
export const runCli = Effect.fnUntraced(function* (
  home: string,
  args: readonly string[]
) {
  const { console, output } = captureConsole();
  const stdio = Stdio.layerTest({ args: Effect.succeed(args) });

  const exit = yield* run(args).pipe(
    Effect.provideService(Console.Console, console),
    Effect.provideService(
      TerminalCapabilities.TerminalCapabilities,
      plainTerminal
    ),
    Effect.provide(stdio),
    Effect.exit
  );

  let exitCode = 0;

  Runtime.defaultTeardown(exit, (code) => {
    exitCode = code;
  });

  const files = yield* readFiles(home);

  return {
    exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    files,
  } satisfies CliResult;
}, Effect.provide(NodeServices.layer));

/**
 * Builds the map in `files` whose home folder is `<system>/map/`, then opens
 * the page that `build` wrote.
 */
export const buildAndOpen = Effect.fnUntraced(function* (
  files: HomeFiles,
  system: string
) {
  const path = yield* Path.Path;
  const home = yield* makeHome(files);
  const result = yield* runCli(home, ["build", path.join(home, system, "map")]);

  assert.strictEqual(result.exitCode, 0, result.stderr);

  return yield* openPage(path.join(home, system, `${system}.html`));
}, Effect.provide(NodeServices.layer));
