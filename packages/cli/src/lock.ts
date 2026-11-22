/* oxlint-disable perfectionist/sort-objects -- schema and table field order sets encoded JSON key order, message order and listing order, so it stays as written */
import {
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Random,
  Schedule,
  Schema,
} from "effect";
import { CliError } from "effect/cli";

import type { HomePaths } from "./home-paths.ts";

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

const lockPathHint =
  ".axonometric/lock, and .axonometric/lock.takeover if it exists, in the home folder";

/**
 * Creates `.axonometric/` in the home folder. The folder holds one process's
 * state, so it carries a `.gitignore` that keeps all of it out of git.
 */
export const stateFolder = Effect.fnUntraced(function* (paths: HomePaths) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(paths.stateFolder, { recursive: true });

  yield* fs
    .writeFileString(paths.gitignoreFile, "*\n", { flag: "wx" })
    .pipe(
      Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void)
    );
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
  /** How long to wait between tries. */
  readonly interval: Duration.Input;
  /** How long to keep retrying in total. */
  readonly timeout: Duration.Input;
}

export const defaultLockWait: LockWait = {
  timeout: Duration.seconds(5),
  interval: Duration.millis(100),
};

/**
 * Windows fails a read with `PermissionDenied` (EPERM) while another process
 * is deleting the file. The deletion finishes within milliseconds, so the read
 * is retried a few times. Elsewhere, and once the tries run out,
 * `PermissionDenied` is a real failure.
 */
const removalRetries = Schedule.spaced(Duration.millis(20)).pipe(
  Schedule.upTo({ duration: Duration.millis(500) })
);

/** The lock file's text, or nothing when there's no lock. */
export const readLock = Effect.fnUntraced(function* (
  file: string,
  platform: NodeJS.Platform = process.platform
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(file).pipe(
    Effect.retry({
      schedule: removalRetries,
      while: (error) =>
        platform === "win32" &&
        Predicate.isTagged(error.reason, "PermissionDenied"),
    }),
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(Option.none<string>())
    )
  );
});

const takeoverSuffix = ".takeover";

/**
 * Stands in for a claimant whose claim file can't be decoded, which only
 * happens when something other than this code wrote it.
 */
const unknownClaimant: LockHolder = {
  pid: 0,
  command: "unknown",
  since: "an unknown time",
};

/**
 * Creates `file` with `content` already in place, or fails with
 * `AlreadyExists`. A hard link fails when its target exists, and a reader
 * never sees a half-written file.
 */
const createWhole = Effect.fnUntraced(function* (
  file: string,
  content: string
) {
  const fs = yield* FileSystem.FileSystem;
  const suffix = yield* Random.nextInt;
  const draft = `${file}.${suffix}.draft`;

  yield* fs.writeFileString(draft, content);

  const discardDraft = Effect.ignore(fs.remove(draft));

  yield* fs.link(draft, file).pipe(Effect.ensuring(discardDraft));
});

/**
 * Removes the lock whose text is `stale`, unless another command is doing so.
 * Returns that command when it is, and nothing once this command has taken
 * its turn.
 *
 * Only two things remove a lock: its holder on release, and the one command
 * that holds the claim `<lock>.takeover`, a second file created the same way
 * as the lock. A command that finds a lock stale may be late, since another
 * command can clear the lock and take a fresh one before this one reads the
 * claim. So the command re-reads the lock under the claim and removes it only
 * while it still holds `stale`.
 */
const takeOverStale = Effect.fnUntraced(function* (
  file: string,
  content: string,
  stale: string
) {
  const fs = yield* FileSystem.FileSystem;
  const claim = `${file}${takeoverSuffix}`;

  const claimed = yield* createWhole(claim, content).pipe(
    Effect.as(true),
    Effect.catchReason("PlatformError", "AlreadyExists", () =>
      Effect.succeed(false)
    )
  );

  if (!claimed) {
    const claimant = yield* readLock(claim);

    return Option.some(
      Option.flatMap(claimant, decodeHolder).pipe(
        Option.getOrElse(() => unknownClaimant)
      )
    );
  }

  const releaseClaim = Effect.ignore(fs.remove(claim));

  yield* Effect.gen(function* () {
    const current = yield* readLock(file);

    if (Option.contains(current, stale)) {
      yield* fs
        .remove(file)
        .pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.void)
        );
    }
  }).pipe(Effect.ensuring(releaseClaim));

  return Option.none<LockHolder>();
});

/**
 * One try at writing `content` to the lock. Returns who holds it when a live
 * process does, or when another command is clearing a stale lock. A lock
 * whose process is gone is removed, and the try starts over.
 *
 * PID reuse isn't guarded against: a stale lock whose PID now belongs to
 * another live process counts as held, and the command times out naming that
 * PID.
 */
export const attempt = Effect.fnUntraced(function* (
  file: string,
  content: string
) {
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

    if (Option.isSome(text)) {
      const claimant = yield* takeOverStale(file, content, text.value);

      if (Option.isSome(claimant)) {
        return claimant;
      }
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
  paths: HomePaths,
  command: string,
  wait: LockWait = defaultLockWait
) {
  const fs = yield* FileSystem.FileSystem;
  const { home, lockFile: file } = paths;

  yield* stateFolder(paths);

  const currentTime = yield* DateTime.now;
  const since = DateTime.formatIso(currentTime);
  const content = yield* encodeHolder({ pid: process.pid, command, since });

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

  // Only one try runs uninterruptibly, inside acquireRelease, so the lock
  // is never taken without its release registered. The wait between tries
  // stays outside it, so Ctrl-C stops a waiting command at once.
  const take = Effect.acquireRelease(attempt(file, content), (holder) =>
    Option.isNone(holder) ? release : Effect.void
  ).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (holder) =>
          Effect.fail(LockHeld.make({ home, command, holder })),
      })
    )
  );

  yield* take.pipe(
    Effect.retry({ schedule: retries, while: Schema.is(LockHeld) })
  );
});
