// Runs a command while holding this machine's test lock, so two suites never
// run at once and slow each other into timeouts. `bun run test` runs turbo
// through it.
//
//   node scripts/with-test-lock.ts [--lock <path>] -- <command> [args...]
//
// The lock is a file in the temp folder that holds the holder's process id,
// command and start time. A run that finds it held waits and says who holds it.
// A lock whose process is gone is taken over. `CI=true` skips the lock.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  linkSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Option, Schema } from "effect";

const Holder = Schema.Struct({
  pid: Schema.Int,
  command: Schema.String,
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
const tryCreate = (lockPath: string, holder: Holder): boolean => {
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

/**
 * Removes the lock of a dead process. The lock moves aside before it is
 * deleted, so a waiter that was slow cannot delete a lock another waiter has
 * just taken. If the moved file turns out to belong to someone else, it goes
 * back.
 */
const takeOverStale = (lockPath: string, stale: Holder): void => {
  const aside = `${lockPath}.${process.pid}.stale`;

  try {
    renameSync(lockPath, aside);
  } catch {
    return;
  }

  const moved = readHolder(aside);

  if (moved?.pid === stale.pid && moved.startedAt === stale.startedAt) {
    unlinkSync(aside);

    return;
  }

  try {
    linkSync(aside, lockPath);
  } finally {
    unlinkSync(aside);
  }
};

const describeHolder = (holder: Holder): string => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(holder.startedAt)) / 60_000)
  );

  return `process ${holder.pid} (${holder.command}) since ${holder.startedAt}, ${minutes} min ago`;
};

const acquire = async (lockPath: string, me: Holder): Promise<void> => {
  let announced = -1;

  while (!tryCreate(lockPath, me)) {
    const holder = readHolder(lockPath);

    if (holder !== null && !isAlive(holder.pid)) {
      process.stderr.write(
        `Taking over the test lock from ${describeHolder(holder)}, which has exited.\n`
      );
      takeOverStale(lockPath, holder);
    } else {
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
  const holder = readHolder(lockPath);

  if (holder?.pid === me.pid && holder.startedAt === me.startedAt) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
  }
};

/** The command this run started, once it has started one. */
let running: ChildProcess | null = null;

const run = (command: string, args: readonly string[]): Promise<number> =>
  new Promise((resolve) => {
    // On Windows a bare name like `turbo` can resolve to a .cmd file, which
    // only a shell runs. A path goes straight to the OS, since a shell would
    // split it at spaces.
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32" && basename(command) === command,
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
    pid: process.pid,
    command: [command, ...args].join(" "),
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

process.exitCode = await main();
