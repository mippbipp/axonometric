import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { bench, web } from "@hona/strobe";

// Drags `updater` on the flake pipeline map, in its last chapter, with the
// pointer held. Each move waits for the page to paint it. Then the run waits
// for the drag warnings panel to finish checking every chapter. The same drag
// as packages/cli/test/drag-warnings-big-map.test.ts, which asserts on it.
//
// Run it through the test lock with `bun run perf`: see CONTRIBUTING.md.

const moves = 16;
const stepPx = 3;
const lastChapter = "c-all";
const storage = { edit: "axonometric-edit", on: "on" };

interface Served {
  readonly child: ChildProcess;
  readonly home: string;
  readonly pid: number;
  readonly url: string;
}

/** The centre of `updater` before the drag, in the viewport. */
let origin: [number, number] = [0, 0];

/** The server a block started, for its teardown. */
let served: Served | null = null;

/** The state `serve` writes once it listens, or null before then. */
const readState = (mapHome: string) => {
  try {
    const state: unknown = JSON.parse(
      readFileSync(join(mapHome, ".axonometric", "server.json"), "utf8")
    );

    if (
      typeof state === "object" &&
      state !== null &&
      "pid" in state &&
      "url" in state &&
      typeof state.pid === "number" &&
      typeof state.url === "string"
    ) {
      return { pid: state.pid, url: state.url };
    }
  } catch {
    // Not written yet.
  }

  return null;
};

/**
 * Copies the variant's flake pipeline fixture into a fresh temporary home
 * folder and starts the variant's own `serve` on a free port.
 */
const startServe = async (root: string): Promise<Served> => {
  const home = mkdtempSync(join(tmpdir(), "axonometric-bench-"));
  const mapHome = join(home, "flake-pipeline", "map");

  cpSync(
    join(root, "packages", "cli", "test", "fixtures", "flake-pipeline"),
    join(home, "flake-pipeline"),
    { recursive: true }
  );

  const child = spawn(
    process.execPath,
    [
      join(root, "packages", "cli", "dist", "bin.mjs"),
      "serve",
      mapHome,
      "--port",
      "0",
    ],
    { stdio: "ignore" }
  );
  const deadline = Date.now() + 30_000;

  for (;;) {
    const state = readState(mapHome);

    if (state !== null) {
      return { child, home, ...state };
    }

    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill();
      rmSync(home, { force: true, recursive: true });
      throw new Error("serve did not start");
    }

    await sleep(25);
  }
};

/** Stops `serve` by its process id, waits for it to exit, and removes its home folder. */
const stopServe = async (running: Served) => {
  try {
    process.kill(running.pid, "SIGTERM");
  } catch {
    // Already gone.
  }

  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      process.kill(running.pid, 0);
    } catch {
      break;
    }

    await sleep(25);
  }

  rmSync(running.home, { force: true, recursive: true });
};

const warnings = "[data-drag-warnings-heading]";

export default bench({
  cases: {
    drag: {
      metrics: ["main.script", "main.layout", "phase.moves", "phase.warnings"],
      primary: "main.work",
      async reset({ page }) {
        // Let go, then undo the drop, so every run starts from the same map.
        await page.up("Mouse");
        await page.click("button text=Undo", { until: "idle" });
        await page.move(...origin, { until: "idle" });
      },
      async run(ctx) {
        const { page } = ctx;
        await page.move(...origin);
        await page.down("Mouse");

        await ctx.phase("moves", async () => {
          for (let move = 1; move <= moves; move += 1) {
            await page.move(origin[0] + move * stepPx, origin[1], {
              until: "frame",
            });
          }
        });

        await ctx.phase("warnings", async () => {
          await page.waitFor(`${warnings}:not([data-checking])`, {
            timeout: 90_000,
          });
        });
      },
    },
  },
  async setup({ page, url }) {
    // A first visit: nothing stored, then Edit on, which a drag needs.
    await page.eval(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.eval(
      (edit: string, on: string) => localStorage.setItem(edit, on),
      storage.edit,
      storage.on
    );
    await page.goto(url);
    await page.click(
      `[data-chapter-rail] button[data-chapter="${lastChapter}"]`,
      { until: `[data-walkthrough][data-chapter="${lastChapter}"]` }
    );
    await page.click('[data-playback-controls] [data-control="pause"]');

    await page.idle();

    const [updater] = await page.query('[data-structure="updater"]');
    const [x = 0, y = 0, width = 0, height = 0] = updater?.rect ?? [];

    origin = [x + width / 2, y + height / 2];
  },
  targets: {
    map: web({
      prepare: async ({ root }) => {
        served = await startServe(root);
      },
      teardown: async () => {
        if (served !== null) {
          const running = served;

          served = null;
          await stopServe(running);
        }
      },
      url: () => served?.url ?? "",
      viewport: { height: 900, width: 1600 },
    }),
  },
});
