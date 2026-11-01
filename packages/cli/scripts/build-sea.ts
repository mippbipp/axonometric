// Builds a Node single-executable binary of the CLI for the OS and
// architecture this runs on, from `dist/sea.cjs` (run `pnpm build` first).
// Writes `release/axonometric-<os>-<arch>/axonometric[.exe]` and packs it into
// `release/axonometric-<os>-<arch>.tar.gz` (`.zip` on Windows).
//
// Node 24 builds the blob with `--experimental-sea-config` and needs postject
// to inject it. Newer Node versions have `--build-sea` instead.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  String as Str,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { inject } from "postject";

const SeaConfig = Schema.Struct({
  main: Schema.String,
  output: Schema.String,
  disableExperimentalSEAWarning: Schema.Boolean,
  useCodeCache: Schema.Boolean,
  useSnapshot: Schema.Boolean,
});

const encodeSeaConfig = Schema.encodeEffect(Schema.fromJsonString(SeaConfig));

class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()("BuildFailed", { message: Schema.String }) {}

const osNames: Partial<Record<NodeJS.Platform, string>> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};

/** Runs a command with the terminal as its output, failing on a non-zero exit. */
const run = Effect.fnUntraced(function* (
  command: string,
  args: readonly string[]
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(command, args, { stdout: "inherit", stderr: "inherit" })
  );

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* BuildFailed.make({
      message: `${command} ${Arr.join(args, " ")} exited with code ${exitCode}.`,
    });
  }

  return exitCode;
});

const buildSea = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const os = osNames[process.platform];

  if (os === undefined) {
    return yield* BuildFailed.make({
      message: `There's no binary target for ${process.platform}.`,
    });
  }

  // Nix's Node links against libraries in /nix/store, so a binary built from
  // it only runs where those store paths exist. pnpm runs scripts with the
  // official Node build from `devEngines`.
  if (Str.startsWith("/nix/store/")(process.execPath)) {
    return yield* BuildFailed.make({
      message: `${process.execPath} is Nix's Node. Run pnpm --filter axonometric build:sea, which uses the official Node build.`,
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

  yield* fs.remove(targetDir, { recursive: true, force: true });
  yield* fs.remove(archive, { force: true });
  yield* fs.makeDirectory(targetDir, { recursive: true });

  const workDir = yield* fs.makeTempDirectoryScoped({
    prefix: "axonometric-sea-",
  });

  const blob = path.join(workDir, "sea-prep.blob");
  const seaConfig = path.join(workDir, "sea-config.json");

  const seaConfigJson = yield* encodeSeaConfig({
    main: path.join(packageDir, "dist", "sea.cjs"),
    output: blob,
    disableExperimentalSEAWarning: true,
    // A code cache makes `import()` fail, and the CLI imports data.mjs.
    useCodeCache: false,
    useSnapshot: false,
  });

  yield* fs.writeFileString(seaConfig, seaConfigJson);

  yield* run(process.execPath, ["--experimental-sea-config", seaConfig]);

  yield* fs.copyFile(process.execPath, binary);
  // The copy keeps the source's mode, which may be read-only.
  yield* fs.chmod(binary, 0o755);

  if (os === "darwin") {
    yield* run("codesign", ["--remove-signature", binary]);
  }

  const blobData = yield* fs.readFile(blob);

  // On Windows, injecting invalidates node.exe's signature, and the binary
  // isn't re-signed because there's no certificate.
  yield* Effect.tryPromise({
    try: () =>
      inject(binary, "NODE_SEA_BLOB", blobData, {
        sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
        // Only Mach-O binaries have segments; ELF and PE ignore this.
        machoSegmentName: "NODE_SEA",
      }),
    catch: (cause) =>
      BuildFailed.make({ message: `postject failed: ${String(cause)}` }),
  });

  // macOS refuses to run an unsigned arm64 binary, so it gets an ad-hoc
  // signature. There's no Apple developer certificate and no notarization.
  if (os === "darwin") {
    yield* run("codesign", ["--sign", "-", binary]);
  }

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
}).pipe(Effect.scoped);

NodeRuntime.runMain(buildSea.pipe(Effect.provide(NodeServices.layer)));
