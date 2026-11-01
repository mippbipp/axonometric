// Packs the npm package into the tarball path given as the only argument,
// then checks what's inside. CI runs it on every pull request, and the
// release workflow stages the tarball it writes, so the check covers exactly
// what gets published. Run `pnpm build` first.
//
// The tarball must hold only package.json, README.md, LICENSE and
// dist/bin.mjs. The editor's HTML is embedded in dist/bin.mjs as a string
// (see tsdown.config.ts), so it has no file of its own. dist/sea.cjs is only
// for the single-executable binaries.
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
});

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PublishedManifest),
  { errors: "all" }
);

interface TarEntry {
  readonly name: string;
  readonly content: Uint8Array;
}

const blockSize = 512;

const readField = (header: Uint8Array, start: number, length: number) =>
  Str.split(
    new TextDecoder().decode(header.subarray(start, start + length)),
    "\0"
  )[0] ?? "";

/**
 * Lists a ustar archive's entries. npm tarballs hold regular files only, with
 * names short enough to need no extension headers, so anything else fails.
 */
const readTar = Effect.fnUntraced(function* (archive: Uint8Array) {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + blockSize <= archive.length) {
    const header = archive.subarray(offset, offset + blockSize);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const prefix = readField(header, 345, 155);
    const baseName = readField(header, 0, 100);
    const name = prefix === "" ? baseName : `${prefix}/${baseName}`;
    const size = Number.parseInt(Str.trim(readField(header, 124, 12)), 8);
    const type = readField(header, 156, 1);

    if (type !== "" && type !== "0") {
      return yield* PackCheckFailed.make({
        message: `The tarball has an entry of type "${type}" at ${name}. Expected regular files only.`,
      });
    }

    const start = offset + blockSize;

    entries.push({ name, content: archive.subarray(start, start + size) });
    offset = start + Math.ceil(size / blockSize) * blockSize;
  }

  return entries;
});

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
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
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

  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* withRepoFiles(packageDir, repoDir);

      const exitCode = yield* spawner.exitCode(
        ChildProcess.make("pnpm", ["pack", "--out", tarball], {
          cwd: packageDir,
          stdout: "inherit",
          stderr: "inherit",
        })
      );

      if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
        return yield* PackCheckFailed.make({
          message: `pnpm pack exited with code ${exitCode}.`,
        });
      }

      return exitCode;
    })
  );

  const archive = yield* fs.readFile(tarball);

  const entries = yield* readTar(
    yield* Effect.tryPromise({
      try: () =>
        new Response(
          new Blob([new Uint8Array(archive)])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"))
        ).bytes(),
      catch: (cause) =>
        PackCheckFailed.make({
          message: `${tarball} isn't a gzip file: ${String(cause)}`,
        }),
    })
  );

  const names = Arr.sort(
    Arr.map(entries, (entry) => Str.replace(/^package\//u, "")(entry.name)),
    Order.String
  );

  if (Arr.join(names, "\n") !== Arr.join(expectedFiles, "\n")) {
    return yield* PackCheckFailed.make({
      message: `The tarball holds:\n  ${Arr.join(names, "\n  ")}\nExpected exactly:\n  ${Arr.join(expectedFiles, "\n  ")}`,
    });
  }

  const manifestEntry = Arr.findFirst(
    entries,
    (entry) => entry.name === "package/package.json"
  );

  const manifestText = Option.match(manifestEntry, {
    onNone: () => "",
    onSome: (entry) => new TextDecoder().decode(entry.content),
  });

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

  yield* Effect.log(`${tarball} holds ${Arr.join(names, ", ")}.`);

  return tarball;
});

NodeRuntime.runMain(packNpm.pipe(Effect.provide(NodeServices.layer)));
