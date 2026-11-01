// Packs the npm package into the tarball path given as the only argument,
// then checks what's inside with the system tar. CI runs it on every pull
// request, and the release workflow stages the tarball it writes, so the
// check covers exactly what gets published. Run `pnpm build` first.
//
// `expectedFiles` is the one list of what the tarball may hold. The editor's
// HTML is embedded in dist/bin.mjs as a string (see tsdown.config.ts), so it
// has no file of its own. dist/sea.cjs is only for the single-executable
// binaries.
//
// pnpm packs it, not npm, because pnpm replaces `workspace:` and `catalog:`
// specifiers with real versions. The repo's README.md and LICENSE are copied
// into the package folder for the pack and removed afterwards.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Record as Rec,
  Schema,
  Stream,
  String as Str,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class PackCheckFailed extends Schema.TaggedError<
  PackCheckFailed,
  { readonly brand: unique symbol }
>()("PackCheckFailed", { message: Schema.String }) {}

const expectedFiles = [
  "LICENSE",
  "README.md",
  "dist/bin.mjs",
  "package.json",
] as const;

const repoFiles = ["README.md", "LICENSE"] as const;

const forbidden = Schema.optionalKey(Schema.Never);

const InstallScriptsAbsent = Schema.Struct({
  preinstall: forbidden,
  install: forbidden,
  postinstall: forbidden,
  prepare: forbidden,
});

// npm's provenance check compares repository.url with the GitHub repo that
// published the package.
const PublishedManifest = Schema.Struct({
  name: Schema.Literal("axonometric"),
  license: Schema.Literal("MIT"),
  repository: Schema.Struct({
    type: Schema.Literal("git"),
    url: Schema.Literal("git+https://github.com/mippbipp/axonometric.git"),
  }),
  // One command. npm refuses to install two packages that claim the same one.
  bin: Schema.Record(Schema.String, Schema.Literal("dist/bin.mjs")).check(
    Schema.makeFilter(
      (bin) =>
        Arr.join(Rec.keys(bin), ",") === "axonometric" ||
        `Expected one command, axonometric, got: ${Arr.join(Rec.keys(bin), ", ")}`
    )
  ),
  engines: Schema.Struct({ node: Schema.Literal(">=24.22.1") }),
  // Everything is bundled into dist/bin.mjs, so installing the package
  // installs nothing else.
  dependencies: Schema.optionalKey(Schema.Never),
  optionalDependencies: Schema.optionalKey(Schema.Never),
  peerDependencies: Schema.optionalKey(Schema.Never),
  bundleDependencies: Schema.optionalKey(Schema.Never),
  // npm runs these on the user's machine when the package installs.
  scripts: Schema.optionalKey(InstallScriptsAbsent),
});

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PublishedManifest),
  { errors: "all" }
);

const PackResult = Schema.Struct({
  filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
});

const decodePackResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PackResult)
);

/** Runs a command and returns its stdout, failing on a non-zero exit. */
const runText = Effect.fnUntraced(function* (
  command: string,
  args: readonly string[],
  cwd: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(command, args, { cwd, stderr: "inherit" })
  );

  const [stdout, exitCode] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
    { concurrency: "unbounded" }
  );

  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* PackCheckFailed.make({
      message: `${command} ${Arr.join(args, " ")} exited with code ${exitCode}.`,
    });
  }

  return stdout;
}, Effect.scoped);

const sorted = (paths: readonly string[]) =>
  Arr.join(Arr.sort(paths, Order.String), "\n  ");

/** Copies the repo's README.md and LICENSE in, and removes them afterwards. */
const withRepoFiles = Effect.fnUntraced(function* (
  packageDir: string,
  repoDir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const file of repoFiles) {
    const target = path.join(packageDir, file);

    if (yield* fs.exists(target)) {
      return yield* PackCheckFailed.make({
        message: `${target} exists. The pack copies it from the repo root, so remove it.`,
      });
    }
  }

  return yield* Effect.acquireRelease(
    Effect.forEach(repoFiles, (file) =>
      fs.copyFile(path.join(repoDir, file), path.join(packageDir, file))
    ),
    () =>
      Effect.forEach(
        repoFiles,
        (file) => fs.remove(path.join(packageDir, file), { force: true }),
        { discard: true }
      ).pipe(Effect.orDie)
  );
});

const packNpm = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outArgument = Arr.get(process.argv, 2);

  if (Option.isNone(outArgument)) {
    return yield* PackCheckFailed.make({
      message: "Usage: node scripts/pack-npm.ts <tarball path>",
    });
  }

  const tarball = path.resolve(outArgument.value);
  const packageDir = path.join(import.meta.dirname, "..");
  const repoDir = path.join(packageDir, "..", "..");

  yield* fs.remove(tarball, { force: true });

  const packOutput = yield* Effect.scoped(
    Effect.andThen(
      withRepoFiles(packageDir, repoDir),
      runText("pnpm", ["pack", "--json", "--out", tarball], packageDir)
    )
  );

  const packed = yield* decodePackResult(packOutput).pipe(
    Effect.mapError((error) =>
      PackCheckFailed.make({
        message: `Can't read pnpm pack --json output:\n${error.message}`,
      })
    )
  );

  const reported = sorted(Arr.map(packed.files, (file) => file.path));

  // pnpm's report must match what tar finds in the tarball it wrote.
  const tarListing = yield* runText("tar", ["-tzf", tarball], packageDir);
  const tarLines = Arr.filter(Str.split(tarListing, "\n"), Str.isNonEmpty);
  const listed = sorted(Arr.map(tarLines, Str.replace(/^package\//u, "")));

  if (listed !== reported) {
    return yield* PackCheckFailed.make({
      message: `pnpm pack reported:\n  ${reported}\nbut ${tarball} holds:\n  ${listed}`,
    });
  }

  if (listed !== sorted(expectedFiles)) {
    return yield* PackCheckFailed.make({
      message: `The tarball holds:\n  ${listed}\nExpected exactly:\n  ${sorted(expectedFiles)}`,
    });
  }

  const manifestText = yield* runText(
    "tar",
    ["-xzOf", tarball, "package/package.json"],
    packageDir
  );

  for (const protocol of ["workspace:", "catalog:"]) {
    if (Str.includes(protocol)(manifestText)) {
      return yield* PackCheckFailed.make({
        message: `The packed package.json still has a ${protocol} specifier.`,
      });
    }
  }

  yield* decodeManifest(manifestText).pipe(
    Effect.mapError((error) =>
      PackCheckFailed.make({
        message: `The packed package.json is wrong:\n${error.message}`,
      })
    )
  );

  yield* Effect.log(
    `${tarball} holds ${Arr.join(Arr.sort(expectedFiles, Order.String), ", ")}.`
  );

  return tarball;
});

NodeRuntime.runMain(packNpm.pipe(Effect.provide(NodeServices.layer)));
