import {
  emptyProposals,
  MapState,
  ProposalsFile,
  ServerState,
} from "@axonometric/contracts";
import type { Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert } from "@effect/vitest";
import {
  Array as Arr,
  Cause,
  Console,
  Duration,
  Effect,
  Exit,
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
import { TerminalCapabilities } from "effect/cli";

import { run } from "../src/cli.ts";
import { openPage, openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";

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

    // A running server takes and releases its lock while this reads, so a
    // file that was listed may be gone a moment later. Skip it.
    const content = yield* fs.stat(absolute).pipe(
      Effect.flatMap((info) =>
        info.type === "File"
          ? Effect.asSome(fs.readFileString(absolute))
          : Effect.succeedNone
      ),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone)
    );

    if (Option.isSome(content)) {
      files[Arr.join(Str.split(entry, path.sep), "/")] = content.value;
    }
  }

  return files;
});

/**
 * Every file in the home folder `home`, keyed as `runCli` returns them,
 * without running the CLI.
 */
export const readHome = (home: string) =>
  readFiles(home).pipe(Effect.provide(NodeServices.layer));

/** The text of `file` in `root`, relative to it. */
export const readIn = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.readFileString(path.join(root, file));
}, Effect.provide(NodeServices.layer));

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

/** Where `serve` records itself for the map in `home`. */
const serverStateFile = (home: string) =>
  Path.Path.use((path) =>
    Effect.succeed(path.join(home, ".axonometric", "server.json"))
  );

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
      Effect.flatMap((ended) =>
        Effect.die(
          new Error(
            `serve exited before it started, with exit code ${exitCodeOf(ended)}.\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}\nexit:\n${Exit.isFailure(ended) ? Cause.pretty(ended.cause) : "success"}`
          )
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

/** The text of proposals.json in `home`, or "" when there's no file. */
export const proposalsText = (home: string) =>
  readHome(home).pipe(Effect.map((files) => files["proposals.json"] ?? ""));

/**
 * The review map in `fullMap`, with `files` added, served on a free port
 * with `args` added to `serve`'s. `root` is the temporary folder and `home`
 * the map's home folder in it.
 */
export const serveReviewMap = Effect.fnUntraced(function* (
  files: HomeFiles,
  args: readonly string[]
) {
  const path = yield* Path.Path;
  const root = yield* makeHome({ ...(yield* fullMap), ...files });
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0", ...args]);

  return { root, home, serve, url: serve.url };
}, Effect.provide(NodeServices.layer));

/**
 * The review map in `fullMap`, with `files` added, served on a free port and
 * open in Chromium at 1280 × 800.
 */
export const openReviewMap = Effect.fnUntraced(function* (files: HomeFiles) {
  const served = yield* serveReviewMap(files, []);
  const opened = yield* openUrl(served.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );

  return { ...served, ...opened };
});

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

/** What proposals.json in `home` holds, or nothing when there's no file. */
export const proposalsIn = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "proposals.json");

  return (yield* fs.exists(file))
    ? Option.some(yield* decodeProposals(yield* fs.readFileString(file)))
    : Option.none<Proposals>();
}, Effect.provide(NodeServices.layer));

/**
 * What proposals.json in `home` holds, or no proposals when there's no file:
 * nothing is written until the first proposal.
 */
export const proposalsOrEmpty = (home: string) =>
  proposalsIn(home).pipe(Effect.map(Option.getOrElse(() => emptyProposals)));

/** What proposals.json in `home` holds. Fails the test when there's no file. */
export const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeProposals(
    yield* fs.readFileString(path.join(home, "proposals.json"))
  );
}, Effect.provide(NodeServices.layer));

/**
 * Waits until proposals.json in `home` reaches `revision`, and returns it.
 * Fails if the file went past `revision`: each write the page makes adds
 * one, so a test that waits for the revision its last action makes finds
 * out when the page wrote more than it should.
 */
export const waitForRevision = Effect.fnUntraced(function* (
  home: string,
  revision: number
) {
  for (let tries = 0; tries < 150; tries++) {
    const now = yield* proposalsIn(home);

    if (Option.isSome(now) && now.value.revision >= revision) {
      assert.strictEqual(now.value.revision, revision);

      return now.value;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail(`proposals.json never reached revision ${revision}`);
});

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(MapState));

/** The map state the HTML page `page` embeds. */
export const pageState = (page: string) =>
  decodeState(
    /id="axonometric-map-state">(?<json>.*?)<\/script>/su.exec(page)?.groups
      ?.json ?? ""
  );
