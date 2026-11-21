import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Order,
  Schedule,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import {
  attributeOf,
  attributesOf,
  callTool,
  callToolWith,
  centreOf,
  click,
  goToChapter,
  inPage,
  openUrl,
  textOf,
  toolsOf,
  waitFor,
  waitGone,
} from "./browser.ts";
import type { ToolInput } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import {
  buildAndOpen,
  makeHome,
  mapIn,
  readHome,
  runCli,
  startServe,
} from "./harness.ts";

const Outcome = Schema.Union([
  Schema.Struct({ notice: Schema.String, ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
]);

const Lit = Schema.Struct({
  hops: Schema.Array(Schema.String),
  structures: Schema.Array(Schema.String),
});

const Read = Schema.Struct({
  chapter: Schema.Struct({ id: Schema.String }),
  inside: Schema.NullOr(Schema.String),
  multiSelection: Schema.Array(Schema.String),
  pinned: Schema.NullOr(Schema.String),
  spotlight: Schema.NullOr(Lit),
  view: Schema.String,
});

type Input = ToolInput;

const servedPage = Effect.gen(function* () {
  const files = yield* pipelineMap;
  const root = yield* makeHome(files);
  const map = mapIn(root, "flake-pipeline");
  const serve = yield* startServe(map.home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  return { ...opened, home: map.home };
});

const builtPage = Effect.gen(function* () {
  const files = yield* pipelineMap;

  return yield* buildAndOpen(files, "flake-pipeline");
});

const pages = [
  { name: "the built file", open: builtPage },
  { name: "the served page", open: servedPage },
];

const readView = (page: Page) => callTool(page, "read_view", Read);

const call = (page: Page, name: string, input: Input) =>
  callToolWith(page, { input, name }, Outcome);

const says = Effect.fnUntraced(function* (
  page: Page,
  { input, tool }: { readonly input: Input; readonly tool: string },
  notice: string
) {
  const result = yield* call(page, tool, input);

  assert.deepStrictEqual(result, { notice, ok: true });
});

const refusal = Effect.fnUntraced(function* (
  page: Page,
  tool: string,
  input: Input
) {
  const result = yield* call(page, tool, input);

  assert.isFalse(result.ok, `${tool} went ahead`);

  return result.ok ? "" : result.reason;
});

const eventually = <A, R>(check: Effect.Effect<A, never, R>) =>
  check.pipe(
    Effect.catchDefect((cause) => Effect.fail(String(cause))),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 60 }),
    Effect.orDie
  );

const brightStructures = (page: Page) =>
  attributesOf(
    page,
    '[data-structure]:not([data-faded="true"])',
    "data-structure"
  );

const brightHops = (page: Page) =>
  attributesOf(page, '[data-hop]:not([data-faded="true"])', "data-hop");

const waitForNotice = (page: Page, text: string) =>
  eventually(
    Effect.gen(function* () {
      const shown = yield* textOf(page, "[data-agent-notice]");

      assert.strictEqual(shown, text);
    })
  );

const waitForBright = (
  page: Page,
  bright: ReadonlyArray<string>,
  faded: ReadonlyArray<string>
) =>
  eventually(
    Effect.gen(function* () {
      const now = yield* brightStructures(page);

      for (const id of bright) {
        assert.include(now, id);
      }

      for (const id of faded) {
        assert.notInclude(now, id);
      }
    })
  );

const lookAt = Effect.fnUntraced(function* (page: Page) {
  const read = yield* readView(page);
  const hops = yield* brightHops(page);
  const structures = yield* brightStructures(page);

  const shown = yield* inPage<{
    chapter: string | null;
    flow: string | null;
    inside: string | null;
    notice: string | null;
    view: string | null;
  }>(
    page,
    `(() => {
      const walk = document.querySelector("[data-walkthrough]");
      return {
        chapter: walk?.getAttribute("data-chapter") ?? null,
        flow: document.querySelector('[data-flow-picker] [data-flow][aria-checked="true"]')?.getAttribute("data-flow") ?? null,
        inside: document.querySelector("[data-inside-view]")?.getAttribute("data-inside-view") ?? null,
        notice: document.querySelector("[data-agent-notice]")?.textContent ?? null,
        view: walk?.getAttribute("data-view") ?? null,
      };
    })()`
  );

  return {
    ...shown,
    brightHops: Arr.sort(hops, Order.String),
    brightStructures: Arr.sort(structures, Order.String),
    multiSelection: read.multiSelection,
    pinned: read.pinned,
    readChapter: read.chapter.id,
    readInside: read.inside,
    readView: read.view,
  };
});

const dialogReason =
  "A dialog is open on the engineer's page. Try again when they close it.";
const dragReason =
  "The engineer is dragging on the map. Try again when they let go.";
const typingReason =
  "The engineer is typing in a field. Try again when they're done.";

const viewTools = [
  "go_to_chapter",
  "set_view",
  "pin",
  "go_inside",
  "pick_flow",
  "spotlight",
];

const emptyPoint = { x: 700, y: 500 };

const overviewPage = "[role='dialog'][data-overview-page][data-open]";

const wait = (page: Page, selector: string) => waitFor(page, selector);

describe("view tools on the page", () => {
  describe.each(pages)("$name", ({ open }) => {
    it.live("go_to_chapter goes to a chapter by number or by id", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;

          yield* says(
            page,
            { input: { chapter: 3 }, tool: "go_to_chapter" },
            "Agent went to chapter 3"
          );
          yield* wait(page, '[data-walkthrough][data-chapter="c-gate"]');
          yield* waitForNotice(page, "Agent went to chapter 3");

          const read = yield* readView(page);

          assert.strictEqual(read.chapter.id, "c-gate");

          yield* says(
            page,
            { input: { chapter: "c-merge" }, tool: "go_to_chapter" },
            "Agent went to chapter 4"
          );
          yield* wait(page, '[data-walkthrough][data-chapter="c-merge"]');
          yield* waitForNotice(page, "Agent went to chapter 4");
          yield* waitForBright(page, ["ruleset"], []);
        })
      )
    );

    it.live("set_view switches between Iso and Plan", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;

          yield* says(
            page,
            { input: { view: "plan" }, tool: "set_view" },
            "Agent switched to Plan view"
          );
          yield* wait(page, '[data-walkthrough][data-view="plan"]');
          yield* waitForNotice(page, "Agent switched to Plan view");

          const read = yield* readView(page);

          assert.strictEqual(read.view, "plan");

          yield* says(
            page,
            { input: { view: "iso" }, tool: "set_view" },
            "Agent switched to Iso view"
          );
          yield* wait(page, '[data-walkthrough][data-view="iso"]');
          yield* waitForNotice(page, "Agent switched to Iso view");
        })
      )
    );

    it.live("pin pins a structure and unpins it with null", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;

          yield* says(
            page,
            { input: { structure: "main" }, tool: "pin" },
            "Agent pinned main"
          );
          yield* waitForNotice(page, "Agent pinned main");

          const pinned = yield* readView(page);

          assert.strictEqual(pinned.pinned, "main");
          yield* waitForBright(page, ["main"], ["upstream"]);

          yield* says(
            page,
            { input: { structure: null }, tool: "pin" },
            "Agent unpinned"
          );
          yield* waitForNotice(page, "Agent unpinned");

          const unpinned = yield* readView(page);

          assert.isNull(unpinned.pinned);
        })
      )
    );

    it.live("go_inside opens a structure's inside view", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;

          yield* says(
            page,
            { input: { structure: "updater" }, tool: "go_inside" },
            "Agent went inside Flake updater"
          );
          yield* wait(page, '[data-inside-view="updater"]');
          yield* waitForNotice(page, "Agent went inside Flake updater");

          const read = yield* readView(page);

          assert.strictEqual(read.inside, "updater");
          assert.strictEqual(read.pinned, "updater");
        })
      )
    );

    it.live("pick_flow picks what the last chapter's picker plays", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;

          yield* goToChapter(page, "c-all");
          yield* says(
            page,
            { input: { flow: "flow:f-repair" }, tool: "pick_flow" },
            "Agent picked flow: A repair round"
          );
          yield* wait(
            page,
            '[data-flow-picker] [data-flow="f-repair"][aria-checked="true"]'
          );
          yield* waitForNotice(page, "Agent picked flow: A repair round");

          yield* says(
            page,
            { input: { flow: "all" }, tool: "pick_flow" },
            "Agent picked flow: All flows"
          );
          yield* wait(
            page,
            '[data-flow-picker] [data-flow="all"][aria-checked="true"]'
          );
          yield* waitForNotice(page, "Agent picked flow: All flows");
        })
      )
    );

    it.live(
      "spotlight lights some structures and hops and fades the rest",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* says(
              page,
              {
                input: {
                  hops: ["h-main-updater"],
                  structures: ["main"],
                },
                tool: "spotlight",
              },
              "Agent spotlit 1 structure and 1 hop"
            );
            yield* waitForNotice(page, "Agent spotlit 1 structure and 1 hop");
            yield* waitForBright(page, ["main"], ["upstream"]);

            const hops = yield* brightHops(page);

            assert.include(hops, "h-main-updater");
            assert.notInclude(hops, "h-upstream-updater");

            const read = yield* readView(page);
            const structures = yield* brightStructures(page);

            assert.sameMembers(
              [...(read.spotlight?.structures ?? [])],
              structures
            );

            yield* says(
              page,
              { input: {}, tool: "spotlight" },
              "Agent cleared the spotlight"
            );
            yield* waitForNotice(page, "Agent cleared the spotlight");
            yield* waitForBright(page, ["upstream", "main"], []);
          })
        )
    );
  });

  describe.each(pages)("refusals on $name", ({ open }) => {
    const invalid = "The input is not valid. ";

    const refusals: ReadonlyArray<{
      readonly before?: (page: Page) => Effect.Effect<void>;
      readonly input: Input;
      readonly reason: string;
      readonly tool: string;
    }> = [
      {
        input: { chapter: 99 },
        reason: "There is no chapter 99. The map has 8 chapters.",
        tool: "go_to_chapter",
      },
      {
        input: { chapter: "nope" },
        reason:
          'There is no chapter with the id "nope". The chapter ids are "c-monday", "c-pr"',
        tool: "go_to_chapter",
      },
      { input: { chapter: 0 }, reason: invalid, tool: "go_to_chapter" },
      { input: { chapter: 1.5 }, reason: invalid, tool: "go_to_chapter" },
      { input: {}, reason: invalid, tool: "go_to_chapter" },
      { input: { view: "side" }, reason: invalid, tool: "set_view" },
      {
        input: { structure: "pr" },
        reason: 'The structure "pr" is not shown in this chapter.',
        tool: "pin",
      },
      {
        input: { structure: "nope" },
        reason: 'The structure "nope" is not shown in this chapter.',
        tool: "pin",
      },
      { input: { structure: 3 }, reason: invalid, tool: "pin" },
      { input: {}, reason: invalid, tool: "pin" },
      {
        input: { structure: "pr" },
        reason: 'The structure "pr" is not shown in this chapter.',
        tool: "go_inside",
      },
      {
        input: { structure: "upstream" },
        reason: "Upstream flake inputs has no steps, so it has no inside view.",
        tool: "go_inside",
      },
      {
        input: { flow: "all" },
        reason:
          "The flow picker shows only in the last chapter. Go there first.",
        tool: "pick_flow",
      },
      {
        before: (page) => goToChapter(page, "c-all"),
        input: { flow: "chapter" },
        reason: 'There is no flow choice "chapter". The choices are',
        tool: "pick_flow",
      },
      {
        before: (page) => goToChapter(page, "c-all"),
        input: { flow: "flow:nope" },
        reason: 'There is no flow choice "flow:nope". The choices are',
        tool: "pick_flow",
      },
      {
        input: { structures: ["pr"] },
        reason: 'The structure "pr" is not shown in this chapter.',
        tool: "spotlight",
      },
      {
        input: { hops: ["h-updater-pr"] },
        reason: 'The hop "h-updater-pr" is not drawn in this chapter.',
        tool: "spotlight",
      },
      {
        input: { hops: ["nope"], structures: ["updater"] },
        reason: 'The hop "nope" is not drawn in this chapter.',
        tool: "spotlight",
      },
      { input: { structures: "updater" }, reason: invalid, tool: "spotlight" },
    ];

    const tools = Arr.dedupe(Arr.map(refusals, ({ tool }) => tool));

    it.live.each(tools)(
      "%s refuses bad input and leaves the page as it was",
      (name) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            for (const row of Arr.filter(
              refusals,
              ({ tool }) => tool === name
            )) {
              if (row.before !== undefined) {
                yield* row.before(page);
              }

              const was = yield* lookAt(page);
              const said = yield* refusal(page, row.tool, row.input);
              const now = yield* lookAt(page);

              assert.isTrue(Str.startsWith(row.reason)(said), said);
              assert.deepStrictEqual(now, was, row.reason);
            }
          })
        )
    );

    it.live(
      "set_view refuses inside a structure with the page's own text",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* says(
              page,
              { input: { structure: "updater" }, tool: "go_inside" },
              "Agent went inside Flake updater"
            );
            yield* wait(page, '[data-inside-view="updater"]');
            yield* waitForNotice(page, "Agent went inside Flake updater");

            const was = yield* lookAt(page);
            const said = yield* refusal(page, "set_view", { view: "plan" });
            const now = yield* lookAt(page);

            assert.strictEqual(
              said,
              "Come out of the inside view to switch views"
            );
            assert.deepStrictEqual(now, was);
            assert.strictEqual(was.view, "iso");
          })
        )
    );
  });

  describe.each(pages)("the engineer's next input on $name", ({ open }) => {
    const inputs: ReadonlyArray<{
      readonly name: string;
      readonly run: (page: Page) => Effect.Effect<void>;
    }> = [
      {
        name: "a click on the empty map",
        run: (page) =>
          Effect.promise(() => page.mouse.click(emptyPoint.x, emptyPoint.y)),
      },
      {
        name: "a key press",
        run: (page) => Effect.promise(() => page.keyboard.press("Shift")),
      },
      {
        name: "a wheel turn",
        run: (page) => Effect.promise(() => page.mouse.wheel(0, 40)),
      },
    ];

    it.live.each(inputs)(
      "clears the notice and the spotlight on $name",
      ({ run }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* Effect.promise(() =>
              page.mouse.move(emptyPoint.x, emptyPoint.y)
            );
            yield* says(
              page,
              { input: { structures: ["main"] }, tool: "spotlight" },
              "Agent spotlit 1 structure"
            );
            yield* waitForNotice(page, "Agent spotlit 1 structure");
            yield* waitForBright(page, ["main"], ["upstream"]);

            yield* run(page);

            yield* waitGone(page, "[data-agent-notice]");
            yield* waitForBright(page, ["main", "upstream"], []);
          })
        )
    );

    it.live(
      "replaces the agent's spotlight when the pointer moves onto a structure",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* says(
              page,
              { input: { structures: ["main"] }, tool: "spotlight" },
              "Agent spotlit 1 structure"
            );
            yield* waitForBright(page, ["main"], ["upstream"]);

            const at = yield* centreOf(page, '[data-structure="upstream"]');

            yield* Effect.promise(() => page.mouse.move(at.x, at.y));
            yield* waitForBright(page, ["upstream"], ["main"]);

            yield* Effect.promise(() =>
              page.mouse.move(emptyPoint.x, emptyPoint.y)
            );

            yield* waitForBright(page, ["upstream", "main"], []);
          })
        )
    );

    it.live(
      "lets the engineer's own chapter click win over go_to_chapter",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* says(
              page,
              { input: { chapter: 3 }, tool: "go_to_chapter" },
              "Agent went to chapter 3"
            );
            yield* wait(page, '[data-walkthrough][data-chapter="c-gate"]');
            yield* waitForNotice(page, "Agent went to chapter 3");

            yield* goToChapter(page, "c-pr");
            yield* waitGone(page, "[data-agent-notice]");

            const chapter = yield* attributeOf(
              page,
              "[data-walkthrough]",
              "data-chapter"
            );

            assert.strictEqual(chapter, "c-pr");
          })
        )
    );
  });

  describe("while the engineer is busy", () => {
    const attempts: ReadonlyArray<readonly [string, Input]> = [
      ["go_to_chapter", { chapter: 2 }],
      ["set_view", { view: "plan" }],
      ["pin", { structure: "main" }],
      ["go_inside", { structure: "updater" }],
      ["pick_flow", { flow: "all" }],
      ["spotlight", { structures: ["main"] }],
    ];

    const refusesEverything = Effect.fnUntraced(function* (
      page: Page,
      reason: string
    ) {
      const was = yield* lookAt(page);

      for (const [tool, input] of attempts) {
        const said = yield* refusal(page, tool, input);

        assert.strictEqual(said, reason, tool);
      }

      const now = yield* lookAt(page);

      assert.deepStrictEqual(now, was);
    });

    it.live(
      "refuses during a box selection drag until the engineer lets go",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* servedPage;

            yield* Effect.promise(() => page.keyboard.down("Shift"));
            yield* Effect.promise(() => page.mouse.move(650, 150));
            yield* Effect.promise(() => page.mouse.down());
            yield* Effect.promise(() =>
              page.mouse.move(760, 330, { steps: 12 })
            );

            yield* refusesEverything(page, dragReason);

            yield* Effect.promise(() => page.mouse.up());
            yield* Effect.promise(() => page.keyboard.up("Shift"));
            yield* says(
              page,
              { input: { chapter: 2 }, tool: "go_to_chapter" },
              "Agent went to chapter 2"
            );
          })
        )
    );

    it.live("refuses during a structure move until the engineer lets go", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* servedPage;
          const from = yield* centreOf(page, '[data-structure="updater"]');

          yield* Effect.promise(() => page.mouse.move(from.x, from.y));
          yield* Effect.promise(() => page.mouse.down());
          yield* Effect.promise(() =>
            page.mouse.move(from.x + 60, from.y + 40, { steps: 12 })
          );

          yield* refusesEverything(page, dragReason);

          yield* Effect.promise(() => page.mouse.up());
          yield* eventually(
            says(
              page,
              { input: { chapter: 2 }, tool: "go_to_chapter" },
              "Agent went to chapter 2"
            )
          );
        })
      )
    );

    it.live("refuses during a group drag until the engineer lets go", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* servedPage;

          yield* goToChapter(page, "c-all");

          const from = yield* centreOf(page, '[data-zone-title-hit="actions"]');

          yield* Effect.promise(() => page.mouse.move(from.x, from.y));
          yield* Effect.promise(() => page.mouse.down());
          yield* Effect.promise(() =>
            page.mouse.move(from.x + 60, from.y + 40, { steps: 12 })
          );
          yield* wait(page, "[data-drag-outline]");

          yield* refusesEverything(page, dragReason);

          yield* Effect.promise(() => page.mouse.up());
          yield* eventually(
            says(
              page,
              { input: { chapter: 2 }, tool: "go_to_chapter" },
              "Agent went to chapter 2"
            )
          );
        })
      )
    );

    it.live("refuses while a hop is drawn until the engineer lets go", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* servedPage;

          yield* goToChapter(page, "c-all");
          yield* click(page, '[data-structure="updater"]');
          yield* wait(page, '[data-edge-owner="updater"]');

          const from = yield* centreOf(page, '[data-edge-owner="updater"]');
          const to = yield* centreOf(page, '[data-structure="workspace"]');

          yield* Effect.promise(() => page.mouse.move(from.x, from.y));
          yield* Effect.promise(() => page.mouse.down());
          yield* Effect.promise(() =>
            page.mouse.move(to.x, to.y, { steps: 12 })
          );

          yield* refusesEverything(page, dragReason);

          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => page.mouse.up());
          yield* eventually(
            says(
              page,
              { input: { chapter: 2 }, tool: "go_to_chapter" },
              "Agent went to chapter 2"
            )
          );
        })
      )
    );

    describe.each(pages)("$name", ({ open }) => {
      it.live("refuses while How it's built is open", () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* click(page, "header [data-control='overview']");
            yield* wait(page, overviewPage);
            yield* refusesEverything(page, dialogReason);

            yield* Effect.promise(() => page.keyboard.press("Escape"));
            yield* waitGone(page, overviewPage);
            yield* says(
              page,
              { input: { chapter: 2 }, tool: "go_to_chapter" },
              "Agent went to chapter 2"
            );
          })
        )
      );
    });

    it.live("refuses while the engineer is typing in a field", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* servedPage;

          yield* click(page, '[data-structure="updater"]');
          yield* wait(page, "[data-note-text]");
          yield* Effect.promise(() =>
            page.locator("[data-note-text]").first().fill("A note")
          );

          yield* refusesEverything(page, typingReason);

          yield* Effect.promise(() =>
            page.locator("[data-note-text]").first().blur()
          );
          yield* says(
            page,
            { input: { chapter: 2 }, tool: "go_to_chapter" },
            "Agent went to chapter 2"
          );
        })
      )
    );
  });

  it.live("no tool changes the map or sends a write", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { home, page } = yield* servedPage;
        const requests: Array<string> = [];

        page.on("request", (request) => {
          requests.push(`${request.method()} ${request.url()}`);
        });

        const before = yield* readHome(home);

        yield* says(
          page,
          { input: { chapter: 3 }, tool: "go_to_chapter" },
          "Agent went to chapter 3"
        );
        yield* says(
          page,
          { input: { view: "plan" }, tool: "set_view" },
          "Agent switched to Plan view"
        );
        yield* says(
          page,
          { input: { structure: "build" }, tool: "pin" },
          "Agent pinned Build gate build jobs"
        );
        yield* says(
          page,
          { input: { structure: null }, tool: "pin" },
          "Agent unpinned"
        );
        yield* says(
          page,
          { input: { structures: ["build"] }, tool: "spotlight" },
          "Agent spotlit 1 structure"
        );
        yield* says(
          page,
          { input: { view: "iso" }, tool: "set_view" },
          "Agent switched to Iso view"
        );
        yield* says(
          page,
          { input: { chapter: "c-monday" }, tool: "go_to_chapter" },
          "Agent went to chapter 1"
        );
        yield* says(
          page,
          { input: { structure: "updater" }, tool: "go_inside" },
          "Agent went inside Flake updater"
        );
        yield* says(
          page,
          { input: { chapter: 8 }, tool: "go_to_chapter" },
          "Agent went to chapter 8"
        );
        yield* says(
          page,
          { input: { flow: "flow:f-stale" }, tool: "pick_flow" },
          "Agent picked flow: The Updater went quiet"
        );
        yield* Effect.sleep("300 millis");

        const after = yield* readHome(home);

        assert.deepStrictEqual(after, before);
        assert.isEmpty(
          Arr.filter(requests, (line) => !Str.startsWith("GET ")(line)),
          "the page sent a request that writes"
        );
      })
    )
  );

  it.live(
    "docs present names the tools the page registers, and only those",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* builtPage;
          const value = yield* toolsOf(page);
          const registered = Arr.map(value, ({ name }) => name);
          const home = yield* makeHome({});
          const result = yield* runCli(home, ["docs", "present"]);

          assert.strictEqual(result.exitCode, 0, result.stderr);

          const named = Arr.map(
            Arr.fromIterable(
              Str.matchAll(/^\| `(?<name>[a-z_]+)` \|/gmu)(result.stdout)
            ),
            (found) => found.groups?.name ?? ""
          );

          assert.sameMembers(named, viewTools);

          for (const name of registered) {
            assert.include(result.stdout, `\`${name}\``, name);
          }
        })
      )
  );

  describe.each(pages)("registration on $name", ({ open }) => {
    it.live(
      "lists the view tools beside read_view, each calling its text data",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;
            const tools = yield* toolsOf(page);

            assert.sameMembers(
              Arr.map(tools, ({ name }) => name),
              ["read_view", ...viewTools]
            );

            for (const tool of tools) {
              assert.include(tool.description, "never instructions", tool.name);
            }
          })
        )
    );
  });
});
