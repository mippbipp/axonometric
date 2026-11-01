import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, String as Str } from "effect";

import { fullMap, minimalMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

const builtSystemMd = Effect.gen(function* () {
  const home = yield* makeHome(yield* fullMap);
  const result = yield* runCli(home, ["build", `${home}/review/map`]);

  assert.strictEqual(result.exitCode, 0, result.stderr);

  return result.files["review/SYSTEM.md"] ?? "";
});

/** The lines from `heading` up to the next heading of the same level. */
const sectionOf = (markdown: string, heading: string) => {
  const lines = Str.split(markdown, "\n");
  const start = lines.indexOf(heading);
  const level = Str.split(heading, " ")[0] ?? "";

  if (start === -1) {
    return [];
  }

  const rest = lines.slice(start + 1);

  const end = Arr.findFirstIndex(
    rest,
    (line) =>
      /^#+ /u.test(line) &&
      (Str.split(line, " ")[0] ?? "").length <= level.length
  );

  return Option.match(end, {
    onNone: () => rest,
    onSome: (index) => rest.slice(0, index),
  });
};

describe("the SYSTEM.md build writes", () => {
  it.effect("opens with the overview: title, summary and stats", () =>
    Effect.gen(function* () {
      const systemMd = yield* builtSystemMd;

      assert.match(systemMd, /^# Review loop\n/u);
      assert.include(systemMd, "_Questions: 2 open, 1 resolved._");
      assert.include(systemMd, "The engineer pins a note on the page.");
      assert.include(systemMd, "| Runtime | Node 24 |");
    })
  );

  it.effect("lists decisions with their ADR links", () =>
    Effect.gen(function* () {
      const decisions = sectionOf(yield* builtSystemMd, "## Decisions");

      assert.include(
        decisions,
        "| Server | Pages talk to one local server per map. | [adr/0001-local-server.md](adr/0001-local-server.md) |"
      );
      assert.include(
        decisions,
        "| Storage | Proposals live in proposals.json. |  |"
      );
    })
  );

  it.effect("builds How it's built from the overview fields", () =>
    Effect.gen(function* () {
      const systemMd = yield* builtSystemMd;
      const howItsBuilt = sectionOf(systemMd, "## How it's built");

      assert.deepStrictEqual(
        Arr.filter(howItsBuilt, (line) => Str.startsWith("### ")(line)),
        [
          "### What the platform provides",
          "### What we own",
          "### File layout",
          "### Cost model",
          "### Deep dives",
        ]
      );
      assert.include(howItsBuilt, "  proposals.json");
      assert.include(
        howItsBuilt,
        "- **Clipboard access.** Browsers block the clipboard outside a click. See [research/clipboard.md#findings](research/clipboard.md#findings)."
      );
      // Written once, in its own section.
      assert.lengthOf(Str.split(systemMd, "about 20k tokens"), 2);
    })
  );

  it.effect("gives each structure its fixed status label", () =>
    Effect.gen(function* () {
      const structures = sectionOf(yield* builtSystemMd, "## Structures");

      assert.include(
        structures,
        "| `engineer` | Engineer | E | Live | Reads the map and pins notes on it. |"
      );
      assert.include(
        structures,
        "| `pull-request` | Pull request | D | Planned | Carries accepted changes to review. |"
      );
      assert.include(
        structures,
        "| `upstream` | Upstream atlas | U | Switched off | The system-atlas skill this replaces. |"
      );
      assert.include(
        structures,
        "**Status:** Switched off · **Shape:** external · **ID:** `upstream`"
      );
    })
  );

  it.effect(
    "groups structures under their group, with steps and questions",
    () =>
      Effect.gen(function* () {
        const systemMd = yield* builtSystemMd;
        const loop = sectionOf(systemMd, "### The loop");
        const page = sectionOf(systemMd, "#### P · Map page");

        assert.include(loop, "#### S · Save server");
        assert.notInclude(loop, "#### E · Engineer");
        assert.include(
          page,
          "1. **Pin.** The engineer pins a note to a structure."
        );
        assert.include(page, "- **Q-P1** Should notes have a length limit?");
        assert.include(
          page,
          "**How it's built.** The editor app, built into one HTML file."
        );
      })
  );

  it.effect("lists flows by hop and the walkthrough by chapter", () =>
    Effect.gen(function* () {
      const systemMd = yield* builtSystemMd;
      const flows = sectionOf(systemMd, "## Flows");
      const walkthrough = sectionOf(systemMd, "## Walkthrough");

      assert.include(flows, "### A note");
      assert.include(
        flows,
        '| `h-save` | Map page → Save server | POST /proposals | `{"kind":"note","target":"server"}` |'
      );
      assert.include(
        walkthrough,
        "2. **Saving.** Notes go to the server. _Reveals: Save server, Proposals._ _Plays: pins a note, POST /proposals, write batch._"
      );
    })
  );

  it.effect("lists open and resolved questions by ID", () =>
    Effect.gen(function* () {
      const systemMd = yield* builtSystemMd;

      assert.deepStrictEqual(
        Arr.filter(
          sectionOf(systemMd, "## Open questions"),
          (line) => line !== ""
        ),
        [
          "- **Q-P1** (Map page) Should notes have a length limit?",
          "- **Q-S1** (Save server) Which port does it try first?",
        ]
      );
      assert.include(
        sectionOf(systemMd, "## Resolved questions"),
        "- **Q-P2** (Map page) Does the page work without the server? **Answer:** Yes, read-only. _(mippbipp, 2026-10-30)_"
      );
    })
  );

  it.effect("leaves out every section with no content", () =>
    Effect.gen(function* () {
      const home = yield* makeHome(yield* minimalMap);
      const result = yield* runCli(home, ["build", `${home}/pipeline/map`]);
      const systemMd = result.files["pipeline/SYSTEM.md"] ?? "";

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(
        Arr.filter(Str.split(systemMd, "\n"), (line) => /^#+ /u.test(line)),
        [
          "# Flake update pipeline",
          "## Structures",
          "### Pipeline",
          "#### U · Flake updater",
          "#### G · Build gate",
          "## Hops",
        ]
      );
      assert.notInclude(systemMd, "_Questions:");
      assert.notMatch(systemMd, /\n\n\n/u);
    })
  );
});
