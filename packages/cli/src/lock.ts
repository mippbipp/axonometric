import {
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Schedule,
  Schema,
} from "effect";
import { CliError } from "effect/cli";

/** What a lock file records about the process holding it. */
export const LockHolder = Schema.Struct({
  pid: Schema.Int,
  command: Schema.String,
  /** When the lock was taken, as an ISO date and time. */
  since: Schema.String,
});

export type LockHolder = typeof LockHolder.Type;

const LockFile = Schema.fromJsonString(LockHolder);

const decodeHolder = Schema.decodeUnknownOption(LockFile);

const encodeHolder = Schema.encodeEffect(LockFile);

/** Another live process held the lock for the whole wait. */
export class LockHeld extends Schema.TaggedError<
  LockHeld,
  { readonly brand: unique symbol }
>()("LockHeld", {
  home: Schema.String,
  command: Schema.String,
  holder: LockHolder,
}) {
  public override get [CliError.userMessage]() {
    return `${this.command} could not take the lock on ${this.home}: process ${this.holder.pid} (${this.holder.command}) has held it since ${this.holder.since}. Wait for it to finish and try again. If no such process is running, remove ${lockPathHint}.`;
  }
}

const lockPathHint = ".axonometric/lock in the home folder";

/**
 * Creates `.axonometric/` in `home` and returns its path. The folder holds
 * one process's state, so it carries a `.gitignore` that keeps all of it out
 * of git.
 */
export const stateFolder = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(home, ".axonometric");

  yield* fs.makeDirectory(folder, { recursive: true });

  yield* fs
    .writeFileString(path.join(folder, ".gitignore"), "*\n", { flag: "wx" })
    .pipe(
      Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void)
    );

  return folder;
});

/**
 * Whether a process with `pid` is running. Signal 0 tests for a process
 * without sending anything, on every platform Node runs on (Windows
 * included). `EPERM` means the process exists but belongs to another user.
 */
export const processIsAlive = (pid: number) => {
  if (pid === process.pid) {
    return true;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** How long a command waits for a held lock before giving up. */
export interface LockWait {
  /** How long to keep retrying in total. */
  readonly timeout: Duration.Input;
  /** How long to wait between tries. */
  readonly interval: Duration.Input;
}

export const defaultLockWait: LockWait = {
  timeout: Duration.seconds(5),
  interval: Duration.millis(100),
};

/** The lock file's text, or nothing when there's no lock. */
const readLock = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(file).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(Option.none<string>())
    )
  );
});

/**
 * One try at writing `content` to the lock. Returns who holds it when a live
 * process does. A lock whose process is gone is removed, and the try starts
 * over.
 */
const attempt = Effect.fnUntraced(function* (file: string, content: string) {
  const fs = yield* FileSystem.FileSystem;

  while (true) {
    // "wx" creates the file and fails if it exists, in one step.
    const created = yield* fs
      .writeFileString(file, content, { flag: "wx" })
      .pipe(
        Effect.as(true),
        Effect.catchReason("PlatformError", "AlreadyExists", () =>
          Effect.succeed(false)
        )
      );

    if (created) {
      return Option.none<LockHolder>();
    }

    // When the lock went away between the two calls, try again.
    const text = yield* readLock(file);

    // A lock that doesn't decode was left half written by a crashed process.
    const holder = Option.flatMap(text, decodeHolder);

    if (Option.isSome(holder) && processIsAlive(holder.value.pid)) {
      return holder;
    }

    // Another command clearing the same stale lock may already have taken
    // a fresh one, so only remove the file while it still holds the stale
    // text.
    const current = yield* readLock(file);

    if (Option.isSome(text) && Option.contains(current, text.value)) {
      yield* fs
        .remove(file)
        .pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.void)
        );
    }
  }
});

/**
 * Takes the lock on the map in `home` for the rest of the current scope, and
 * releases it when the scope closes, whether the work succeeded, failed or
 * was interrupted. A lock whose process is gone is removed and taken. A lock
 * held by a live process is retried until `wait.timeout`, then fails with
 * `LockHeld`, naming the holder. `command` is recorded in the lock, so a
 * waiting command can say who holds it.
 */
export const withLock = Effect.fnUntraced(function* (
  home: string,
  command: string,
  wait: LockWait = defaultLockWait
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(yield* stateFolder(home), "lock");

  const since = DateTime.formatIso(yield* DateTime.now);
  const content = yield* encodeHolder({ pid: process.pid, command, since });

  const take = attempt(file, content).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (holder) =>
          Effect.fail(LockHeld.make({ home, command, holder })),
      })
    )
  );

  // Only remove the lock while it's still ours.
  const release = readLock(file).pipe(
    Effect.flatMap((current) =>
      Option.contains(current, content) ? fs.remove(file) : Effect.void
    ),
    Effect.ignore
  );

  const retries = Schedule.spaced(wait.interval).pipe(
    Schedule.upTo({ duration: wait.timeout })
  );

  const takeOrWait = take.pipe(
    Effect.retry({ schedule: retries, while: Schema.is(LockHeld) })
  );

  yield* Effect.acquireRelease(takeOrWait, () => release);
});
