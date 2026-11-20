// Builds a standalone binary of the CLI for the OS and architecture this runs
// on, from `dist/bin.mjs` (run `bun run build` first). Writes
// `release/axonometric-<os>-<arch>/axonometric[.exe]` and packs it into
// `release/axonometric-<os>-<arch>.tar.gz` (`.zip` on Windows).
//
// `bun build --compile` embeds the Bun runtime. The editor page, the docs, the
// PNG renderer's WASM and its fonts are already strings inside `dist/bin.mjs`
// (see tsdown.config.ts), so the binary needs no files next to it.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Array as Arr, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()("BuildFailed", { message: Schema.String }) {}

const osNames: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

/** Runs a command with the terminal as its output, failing on a non-zero exit. */
const run = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(command, args, { stderr: "inherit", stdout: "inherit" })
  );

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* BuildFailed.make({
      message: `${command} ${Arr.join(args, " ")} exited with code ${exitCode}.`,
    });
  }

  return exitCode;
});

const buildBinary = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const os = osNames[process.platform];

  if (os === undefined) {
    return yield* BuildFailed.make({
      message: `There's no binary target for ${process.platform}.`,
    });
  }

  const packageDir = path.join(import.meta.dirname, "..");
  const releaseDir = path.join(packageDir, "release");
  const target = `axonometric-${os}-${process.arch}`;
  const targetDir = path.join(releaseDir, target);
  const binaryName = os === "windows" ? "axonometric.exe" : "axonometric";
  const binary = path.join(targetDir, binaryName);

  const archive = path.join(
    releaseDir,
    `${target}${os === "windows" ? ".zip" : ".tar.gz"}`
  );

  yield* fs.remove(targetDir, { force: true, recursive: true });
  yield* fs.remove(archive, { force: true });
  yield* fs.makeDirectory(targetDir, { recursive: true });

  // The compiled binary doesn't read .env, bunfig.toml, tsconfig.json or
  // package.json from the folder it runs in. A user's project must not change
  // how the CLI behaves. Bun signs macOS binaries ad hoc itself, since macOS
  // refuses to run an unsigned arm64 binary. There's no Apple developer
  // certificate and no notarization, and the Windows binary isn't signed.
  yield* run("bun", [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    path.join(packageDir, "dist", "bin.mjs"),
    "--outfile",
    binary,
  ]);

  // The archive holds the binary alone, at its top level.
  yield* os === "windows"
    ? run("powershell", [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${binary}' -DestinationPath '${archive}'`,
      ])
    : run("tar", ["-czf", archive, "-C", targetDir, binaryName]);

  yield* Effect.log(`Built ${binary} and ${archive}.`);

  return binary;
});

NodeRuntime.runMain(buildBinary.pipe(Effect.provide(NodeServices.layer)));
