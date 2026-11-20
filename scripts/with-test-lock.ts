// Runs a command while holding this machine's test lock, so two suites never
// run at once and slow each other into timeouts. `bun run test` runs turbo
// through it.
//
//   node scripts/with-test-lock.ts [--lock <path>] -- <command> [args...]
//
// The lock is a file in the temp folder that holds the holder's process id,
// command and start time. A run that finds it held waits and says who holds it.
// A lock whose process is gone is taken over. A lock file that can't be read
// is waited on, with a message that says how to clear it. `CI=true` skips the
// lock.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  linkSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Option, Schema } from "effect";

const Holder = Schema.Struct({
  command: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.String,
});

type Holder = typeof Holder.Type;

const pollMs = 250;

const defaultLockPath = join(tmpdir(), "axonometric-test.lock.json");

const decodeHolder = Schema.decodeUnknownOption(Schema.fromJsonString(Holder));

const parseHolder = (text: string): Holder | null =>
  Option.getOrNull(decodeHolder(text));

const readHolder = (lockPath: string): Holder | null => {
  try {
    return parseHolder(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
};

/** EPERM means the process exists but belongs to someone else. */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const skipsLock = (): boolean => {
  const ci = process.env.CI ?? "";

  return ci !== "" && ci !== "false" && ci !== "0";
};

/**
 * Creates the lock with its content already in place, or returns false when it
 * exists. A hard link fails if the target exists, and a reader never sees a
 * half-written file.
 */
export const tryCreate = (lockPath: string, holder: Holder): boolean => {
  const draft = `${lockPath}.${holder.pid}.draft`;
  writeFileSync(draft, JSON.stringify(holder));

  try {
    linkSync(draft, lockPath);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }

    throw error;
  } finally {
    unlinkSync(draft);
  }
};

const describeHolder = (holder: Holder): string => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(holder.startedAt)) / 60_000)
  );

  return `process ${holder.pid} (${holder.command}) since ${holder.startedAt}, ${minutes} min ago`;
};

const sameHolder = (a: Holder | null, b: Holder): boolean =>
  a?.pid === b.pid && a.startedAt === b.startedAt;

/**
 * Removes `stale`, the lock of a dead process, unless another run is removing
 * it. Returns that run's claim, or null when this run is done.
 *
 * Only two things remove a lock: its holder on exit, and the one run that
 * holds the takeover claim, a second file created the same way as the lock.
 * So while this run holds the claim, a dead holder's lock can't leave the path
 * by any other hand, and the lock it reads is the lock it removes. A claim
 * left by a run that died holding it is not cleared here, since clearing it
 * safely would need a claim of its own.
 */
export const takeOverStale = (
  lockPath: string,
  stale: Holder,
  me: Holder
): Holder | null => {
  const claimPath = `${lockPath}.takeover`;

  if (!tryCreate(claimPath, me)) {
    return readHolder(claimPath);
  }

  try {
    if (sameHolder(readHolder(lockPath), stale)) {
      process.stderr.write(
        `Taking over the test lock from ${describeHolder(stale)}, which has exited.\n`
      );
      unlinkSync(lockPath);
    }
  } finally {
    unlinkSync(claimPath);
  }

  return null;
};

const acquire = async (lockPath: string, me: Holder): Promise<void> => {
  let announced = -1;
  let announcedUnreadable = false;
  let announcedClaim = false;

  while (!tryCreate(lockPath, me)) {
    const holder = readHolder(lockPath);

    if (holder !== null && !isAlive(holder.pid)) {
      const claimant = takeOverStale(lockPath, holder, me);

      if (claimant !== null) {
        if (!announcedClaim && !isAlive(claimant.pid)) {
          announcedClaim = true;
          process.stderr.write(
            `Waiting for the test lock. Process ${claimant.pid} exited while taking over a stale lock and left ${lockPath}.takeover. If no run holds the lock, delete that file.\n`
          );
        }

        await sleep(pollMs);
      }
    } else {
      if (holder === null && !announcedUnreadable && existsSync(lockPath)) {
        announcedUnreadable = true;
        process.stderr.write(
          `Waiting for the test lock. The lock file at ${lockPath} can't be read and names no holder. If no run holds it, delete the file.\n`
        );
      }

      if (holder !== null && holder.pid !== announced) {
        announced = holder.pid;
        process.stderr.write(
          `Waiting for the test lock, held by ${describeHolder(holder)}.\n`
        );
      }

      await sleep(pollMs);
    }
  }
};

const release = (lockPath: string, me: Holder): void => {
  if (sameHolder(readHolder(lockPath), me)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
  }
};

/** The command this run started, once it has started one. */
let running: ChildProcess | null = null;

const run = (command: string, args: ReadonlyArray<string>): Promise<number> =>
  new Promise((resolve) => {
    // On Windows a bare name like `turbo` can resolve to a .cmd file, which
    // only a shell runs. A path goes straight to the OS, since a shell would
    // split it at spaces.
    const child = spawn(command, args, {
      shell: process.platform === "win32" && basename(command) === command,
      stdio: "inherit",
    });

    running = child;
    child.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 128));
    });
  });

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  let lockPath = defaultLockPath;

  if (argv[0] === "--lock") {
    lockPath = argv[1] ?? "";
    argv.splice(0, 2);
  }

  if (argv[0] === "--") {
    argv.shift();
  }

  const [command, ...args] = argv;

  if (command === undefined || lockPath === "") {
    process.stderr.write(
      "Usage: with-test-lock.ts [--lock <path>] -- <command> [args...]\n"
    );

    return 2;
  }

  const me: Holder = {
    command: [command, ...args].join(" "),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  // One handler from start to finish, so no signal falls between waiting and
  // running. While waiting, a signal frees the lock and exits. Once the command
  // runs, it goes to the command, and its exit ends this run.
  const onSignal = (signal: NodeJS.Signals): void => {
    if (running === null) {
      release(lockPath, me);
      process.exit(128 + (signal === "SIGINT" ? 2 : 15));
    }

    running.kill(signal);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", () => {
    release(lockPath, me);
  });

  if (!skipsLock()) {
    await acquire(lockPath, me);
  }

  return run(command, args);
};

if (import.meta.main) {
  process.exitCode = await main();
}
