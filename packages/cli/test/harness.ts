import { ServerState } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert } from "@effect/vitest";
import {
  Array as Arr,
  Console,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Record as Rec,
  Runtime,
  Schedule,
  Schema,
  Stdio,
  String as Str,
} from "effect";
import type { Exit } from "effect";
import { TerminalCapabilities } from "effect/cli";

import { run } from "../src/cli.ts";
import { serverStateFile } from "../src/server-state.ts";
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

/** Runs the CLI in-process with `args`, writing its output to `output`. */
const runCaptured = (args: readonly string[]) => {
  const { console, output } = captureConsole();
  const stdio = Stdio.layerTest({ args: Effect.succeed(args) });

  const exit = run(args).pipe(
    Effect.provideService(Console.Console, console),
    Effect.provideService(
      TerminalCapabilities.TerminalCapabilities,
      plainTerminal
    ),
    Effect.provide(Layer.merge(stdio, NodeServices.layer)),
    Effect.exit
  );

  return { exit, output };
};

const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) => {
  let exitCode = 0;

  Runtime.defaultTeardown(exit, (code) => {
    exitCode = code;
  });

  return exitCode;
};

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
  const { exit, output } = runCaptured(args);
  const exitCode = exitCodeOf(yield* exit);
  const files = yield* readFiles(home);

  return {
    exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    files,
  } satisfies CliResult;
}, Effect.provide(NodeServices.layer));

const decodeServerState = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServerState)
);

/** How often, and for how long, to look for a starting server. */
const serverWait = Schedule.spaced(Duration.millis(25)).pipe(
  Schedule.upTo({ duration: Duration.seconds(15) })
);

/**
 * Waits until `.axonometric/server.json` in `home` names a server other than
 * `previous`, and returns it.
 */
const waitForServer = Effect.fnUntraced(function* (
  home: string,
  previous?: string
) {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* serverStateFile(home);

  const read = fs.readFileString(file).pipe(
    Effect.map(decodeServerState),
    Effect.orElseSucceed(() => Option.none<ServerState>()),
    Effect.flatMap((state) =>
      Option.isSome(state) && state.value.since !== previous
        ? Effect.succeed(state.value)
        : Effect.fail("no server yet")
    )
  );

  return yield* read.pipe(Effect.retry(serverWait), Effect.orDie);
});

/** A `serve` running in-process, started by `startServe`. */
export interface RunningServe {
  readonly url: string;
  readonly state: ServerState;
  /** What it has printed so far. */
  readonly output: { readonly stdout: string; readonly stderr: string };
  /** Stops it as Ctrl-C would, by interrupting it. */
  readonly stop: Effect.Effect<void>;
}

/**
 * Starts `axonometric serve` in-process with `args`, whose home folder is
 * `home`, and returns once it has written its state file. It stops when the
 * test's scope closes, if not before.
 */
export const startServe = Effect.fnUntraced(function* (
  home: string,
  args: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* serverStateFile(home);

  const previous = yield* fs.readFileString(file).pipe(
    Effect.map(decodeServerState),
    Effect.map(Option.map((state) => state.since)),
    Effect.orElseSucceed(() => Option.none<string>())
  );

  const { exit, output } = runCaptured(["serve", home, ...args]);
  const fiber = yield* Effect.forkScoped(exit);

  const state = yield* Effect.raceFirst(
    waitForServer(home, Option.getOrUndefined(previous)),
    Fiber.join(fiber).pipe(
      Effect.flatMap(() =>
        Effect.die(
          new Error(`serve exited before it started:\n${output.stderr}`)
        )
      )
    )
  );

  return {
    url: state.url,
    state,
    output,
    stop: Fiber.interrupt(fiber),
  } satisfies RunningServe;
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
