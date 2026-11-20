import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Option, Schema } from "effect";

const script = join(import.meta.dirname, "with-test-lock.ts");

let dir = "";

before(() => {
  dir = mkdtempSync(join(tmpdir(), "with-test-lock-"));
});

after(() => {
  rmSync(dir, { force: true, recursive: true });
});

interface Finished {
  readonly code: number | null;
  readonly output: string;
}

interface Running {
  readonly child: ChildProcess;
  readonly finished: Promise<Finished>;
  output: () => string;
}

/** Runs the lock script around `node -e <code>` against its own lock file. */
const start = (lockPath: string, code: string, ci = "false"): Running => {
  const child = spawn(
    process.execPath,
    [script, "--lock", lockPath, "--", process.execPath, "-e", code],
    { env: { ...process.env, CI: ci }, stdio: ["ignore", "pipe", "pipe"] }
  );

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const finished = new Promise<Finished>((resolve) => {
    child.on("close", (exitCode) => {
      resolve({ code: exitCode, output });
    });
  });

  return { child, finished, output: () => output };
};

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (ready()) {
      return;
    }

    await sleep(50);
  }

  assert.fail("timed out waiting");
};

const Holder = Schema.fromJsonString(
  Schema.Struct({
    command: Schema.String,
    pid: Schema.Int,
    startedAt: Schema.String,
  })
);

const holderIn = (lockPath: string) =>
  Option.getOrThrow(
    Schema.decodeOption(Holder)(readFileSync(lockPath, "utf8"))
  );

const waitsFor = (file: string): string =>
  `const fs = require("node:fs"); const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(file)})) { clearInterval(t); } }, 20);`;

void describe("with-test-lock", () => {
  void it("makes a second run wait, naming the holder once, until the first exits", async () => {
    const lock = join(dir, "wait.lock");
    const release = join(dir, "wait.release");
    const ran = join(dir, "wait.ran");
    const first = start(lock, waitsFor(release));
    await until(() => existsSync(lock));

    const holder = holderIn(lock);

    assert.equal(holder.pid, first.child.pid);

    const second = start(
      lock,
      `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "")`
    );

    await until(() => second.output().includes("Waiting"));
    await sleep(700);
    assert.equal(existsSync(ran), false);
    assert.match(second.output(), new RegExp(`process ${holder.pid} `, "u"));
    assert.ok(second.output().includes(holder.command));
    assert.ok(second.output().includes(holder.startedAt));

    writeFileSync(release, "");
    const firstDone = await first.finished;

    assert.equal(firstDone.code, 0);
    const done = await second.finished;
    assert.equal(done.code, 0);
    assert.equal(existsSync(ran), true);
    assert.equal(done.output.match(/Waiting/gu)?.length, 1);
    assert.equal(existsSync(lock), false);
  });

  void it("takes over a lock whose process no longer exists", async () => {
    const lock = join(dir, "stale.lock");
    const dead = spawn(process.execPath, ["-e", ""]);
    await new Promise<void>((resolve) => {
      dead.on("close", () => {
        resolve();
      });
    });
    writeFileSync(
      lock,
      JSON.stringify({
        command: "turbo run test",
        pid: dead.pid,
        startedAt: "2026-01-01T00:00:00.000Z",
      })
    );

    const run = await start(lock, "").finished;
    assert.equal(run.code, 0);
    assert.match(run.output, /Taking over the test lock/u);
    assert.equal(existsSync(lock), false);
  });

  void it("waits on a lock file it can't read, says so once, and leaves the file", async () => {
    const lock = join(dir, "garbled.lock");
    const ran = join(dir, "garbled.ran");
    writeFileSync(lock, "not json");

    const run = start(
      lock,
      `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "")`
    );

    await until(() => run.output().includes("can't be read"));
    await sleep(700);
    assert.equal(existsSync(ran), false);
    assert.ok(run.output().includes(lock));
    assert.match(run.output(), /delete the file/u);
    assert.equal(readFileSync(lock, "utf8"), "not json");
    run.child.kill("SIGTERM");
    await run.finished;
    assert.equal(run.output().match(/can't be read/gu)?.length, 1);
    assert.equal(readFileSync(lock, "utf8"), "not json");
  });

  void it("skips the lock when CI is true", async () => {
    const lock = join(dir, "ci.lock");

    const held = JSON.stringify({
      command: "turbo run test",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    writeFileSync(lock, held);

    const run = await start(lock, "", "true").finished;
    assert.equal(run.code, 0);
    assert.doesNotMatch(run.output, /Waiting/u);
    assert.equal(readFileSync(lock, "utf8"), held);
  });

  void it("frees the lock and passes on the exit code when the command fails", async () => {
    const lock = join(dir, "fail.lock");
    const run = await start(lock, "process.exit(3)").finished;
    assert.equal(run.code, 3);
    assert.equal(existsSync(lock), false);
  });

  void it(
    "frees the lock on Ctrl-C",
    { skip: process.platform === "win32" },
    async () => {
      const lock = join(dir, "sigint.lock");
      const run = start(lock, "setInterval(() => {}, 1000)");
      await until(() => existsSync(lock));
      run.child.kill("SIGINT");
      await run.finished;
      assert.equal(existsSync(lock), false);
    }
  );
});
