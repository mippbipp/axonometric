import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import {
  applyLayoutChanges,
  compareMarks,
  describeDifferences,
  diffMaps,
  ghostedMap,
  restoreChanges,
} from "../src/index.ts";
import type {
  Layout,
  LayoutChange,
  MapData,
  MapSnapshot,
} from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

// Seam 3: the diff between two maps, as plain data in and plain data out.

const withLayout = (
  { data, layout }: MapSnapshot,
  structures: Layout["structures"],
  routes?: Layout["routes"]
): MapSnapshot => ({
  data,
  layout: {
    ...layout,
    structures: { ...layout.structures, ...structures },
    ...(routes === undefined ? {} : { routes }),
  },
});

const withData = (
  { data, layout }: MapSnapshot,
  change: (data: MapData) => MapData
): MapSnapshot => ({ data: change(data), layout });

const review = Effect.gen(function* () {
  const { data, layout } = yield* fixture("review");

  return { data, layout } satisfies MapSnapshot;
});

const ids = (changes: readonly { readonly id: string }[]) =>
  Arr.map(changes, ({ id }) => id);

describe(diffMaps, () => {
  it.effect("finds nothing between a map and itself", () =>
    Effect.gen(function* () {
      const map = yield* review;
      const diff = diffMaps(map, map);

      assert.deepStrictEqual(diff.structures, {
        moved: [],
        resized: [],
        added: [],
        removed: [],
        changed: [],
      });
      assert.deepStrictEqual(diff.hops, {
        added: [],
        removed: [],
        changed: [],
      });
      assert.deepStrictEqual(diff.sections, []);
      assert.deepStrictEqual(diff.rerouted, []);
    })
  );

  it.effect("reports a move with where it came from and where it went", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withLayout(before, {
        page: { x: 4, y: 4, w: 2, d: 2 },
      });

      const { structures } = diffMaps(before, after);

      assert.deepStrictEqual(structures.moved, [
        {
          id: "page",
          from: { x: 4, y: 0, w: 2, d: 2 },
          to: { x: 4, y: 4, w: 2, d: 2 },
        },
      ]);
      assert.deepStrictEqual(structures.resized, []);
    })
  );

  it.effect("reports a resize apart from a move, and both for one structure", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const resized = diffMaps(
        before,
        withLayout(before, { server: { x: 8, y: 0, w: 3, d: 2 } })
      ).structures;

      assert.deepStrictEqual(ids(resized.resized), ["server"]);
      assert.deepStrictEqual(resized.moved, []);

      const both = diffMaps(
        before,
        withLayout(before, { server: { x: 9, y: 0, w: 3, d: 2 } })
      ).structures;

      assert.deepStrictEqual(ids(both.moved), ["server"]);
      assert.deepStrictEqual(ids(both.resized), ["server"]);
    })
  );

  it.effect("lists structures only in one map as added or removed, not as moved", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const [first, ...rest] = before.data.structures;

      assert.isDefined(first);

      const after = withData(before, (data) => ({
        ...data,
        structures: [
          ...rest,
          { ...(first ?? rest[0]!), id: "cache", code: "C", name: "Cache" },
        ],
      }));

      const { structures } = diffMaps(before, after);

      assert.deepStrictEqual(structures.added, ["cache"]);
      assert.deepStrictEqual(structures.removed, [first?.id]);
      assert.deepStrictEqual(structures.moved, []);
    })
  );

  it.effect("names the text fields that changed, and ignores the rest", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withData(before, (data) => ({
        ...data,
        structures: Arr.map(data.structures, (structure) =>
          structure.id === "server"
            ? {
                ...structure,
                name: "Save service",
                oneLiner: "Saves edits.",
              }
            : structure
        ),
      }));

      assert.deepStrictEqual(diffMaps(before, after).structures.changed, [
        { id: "server", fields: ["name", "oneLiner"] },
      ]);
    })
  );

  it.effect("sees a field that is dropped, such as steps, but not one set to undefined", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const dropped = withData(before, (data) => ({
        ...data,
        structures: Arr.map(data.structures, (structure) => {
          const { steps: _steps, ...rest } = structure;

          return structure.id === "page" ? rest : structure;
        }),
      }));

      assert.deepStrictEqual(diffMaps(before, dropped).structures.changed, [
        { id: "page", fields: ["steps"] },
      ]);

      const unset = withData(before, (data) => ({
        ...data,
        structures: Arr.map(data.structures, (structure) =>
          structure.id === "server"
            ? { ...structure, sources: undefined }
            : structure
        ),
      }));

      assert.deepStrictEqual(diffMaps(before, unset).structures.changed, []);
    })
  );

  it.effect("compares hops: added, removed and changed text", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withData(before, (data) => ({
        ...data,
        hops: [
          ...Arr.map(
            Arr.filter(data.hops, ({ id }) => id !== "h-pr"),
            (hop) =>
              hop.id === "h-store" ? { ...hop, label: "writes a batch" } : hop
          ),
          { id: "h-new", from: "page", to: "proposals", label: "reads" },
        ],
      }));

      assert.deepStrictEqual(diffMaps(before, after).hops, {
        added: ["h-new"],
        removed: ["h-pr"],
        changed: [{ id: "h-store", fields: ["label"] }],
      });
    })
  );

  it.effect("reports a rewired hop and a changed payload as changed", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withData(before, (data) => ({
        ...data,
        hops: Arr.map(data.hops, (hop) =>
          hop.id === "h-save"
            ? { ...hop, to: "proposals", payload: { kind: "other" } }
            : hop
        ),
      }));

      assert.deepStrictEqual(diffMaps(before, after).hops.changed, [
        { id: "h-save", fields: ["to", "payload"] },
      ]);
    })
  );

  it.effect("names the other parts of the data that differ", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withData(before, (data) => ({
        ...data,
        overview: { ...data.overview, summary: "Another summary." },
        chapters: data.chapters.slice(1),
      }));

      assert.deepStrictEqual(diffMaps(before, after).sections, [
        "overview",
        "chapters",
      ]);
    })
  );

  it.effect("lists hops whose route override differs", () =>
    Effect.gen(function* () {
      const before = yield* review;

      const after = withLayout(before, {}, {
        "h-save": [
          { x: 6, y: 1 },
          { x: 8, y: 1 },
        ],
      });

      assert.deepStrictEqual(diffMaps(before, after).rerouted, ["h-save"]);
    })
  );
});

describe(restoreChanges, () => {
  const idsFrom = (prefix: string) => {
    let counter = 0;

    return () => `${prefix}-${(counter += 1)}`;
  };

  it.effect("puts every moved and resized structure where the revision has it", () =>
    Effect.gen(function* () {
      const current = yield* review;

      const revision = withLayout(current, {
        engineer: { x: 0, y: 4, w: 2, d: 2 },
        page: { x: 4, y: 4, w: 2, d: 2 },
        server: { x: 8, y: 0, w: 3, d: 2 },
      });

      const changes = restoreChanges({
        current: current.data,
        revision,
        changes: [],
        accepted: current.layout,
        newId: idsFrom("r"),
      });

      assert.deepStrictEqual(changes, [
        {
          id: "r-1",
          kind: "move",
          moves: [
            {
              target: { kind: "structure", id: "engineer" },
              position: { x: 0, y: 4 },
            },
          ],
        },
        {
          id: "r-2",
          kind: "move",
          moves: [
            {
              target: { kind: "structure", id: "page" },
              position: { x: 4, y: 4 },
            },
          ],
        },
        {
          id: "r-3",
          kind: "resize",
          target: { kind: "structure", id: "server" },
          footprint: { w: 3, d: 2 },
        },
      ]);
      assert.deepStrictEqual(
        applyLayoutChanges(current.layout, changes).structures,
        revision.layout.structures
      );
    })
  );

  it.effect("takes over a structure's pending move instead of piling on another", () =>
    Effect.gen(function* () {
      const accepted = yield* review;

      const pending: LayoutChange = {
        id: "mine",
        kind: "move",
        moves: [
          {
            target: { kind: "structure", id: "page" },
            position: { x: 4, y: 8 },
          },
        ],
      };

      const shown: MapSnapshot = {
        data: accepted.data,
        layout: applyLayoutChanges(accepted.layout, [pending]),
      };

      const revision = withLayout(accepted, {
        page: { x: 4, y: 4, w: 2, d: 2 },
      });

      const changes = restoreChanges({
        current: shown.data,
        revision,
        changes: [pending],
        accepted: accepted.layout,
        newId: idsFrom("r"),
      });

      assert.deepStrictEqual(ids(changes), ["mine"]);
      assert.deepStrictEqual(
        applyLayoutChanges(accepted.layout, changes).structures.page,
        { x: 4, y: 4, w: 2, d: 2 }
      );
    })
  );

  it.effect("drops a pending move when the revision has the structure at its accepted place", () =>
    Effect.gen(function* () {
      const accepted = yield* review;

      const pending: LayoutChange = {
        id: "mine",
        kind: "move",
        moves: [
          {
            target: { kind: "structure", id: "page" },
            position: { x: 4, y: 8 },
          },
        ],
      };

      const shown: MapSnapshot = {
        data: accepted.data,
        layout: applyLayoutChanges(accepted.layout, [pending]),
      };

      const changes = restoreChanges({
        current: shown.data,
        revision: accepted,
        changes: [pending],
        accepted: accepted.layout,
        newId: idsFrom("r"),
      });

      assert.deepStrictEqual(changes, []);
    })
  );

  it.effect("makes nothing when no layout differs", () =>
    Effect.gen(function* () {
      const map = yield* review;

      assert.deepStrictEqual(
        restoreChanges({
          current: map.data,
          revision: map,
          changes: [],
          accepted: map.layout,
          newId: idsFrom("r"),
        }),
        []
      );
    })
  );
});

describe(compareMarks, () => {
  it.effect("marks each structure and hop by what differs", () =>
    Effect.gen(function* () {
      const current = yield* review;

      const revision = withData(
        withLayout(current, {
          page: { x: 4, y: 4, w: 3, d: 2 },
        }),
        (data) => ({
          ...data,
          structures: Arr.map(data.structures, (structure) =>
            structure.id === "server"
              ? { ...structure, oneLiner: "Different." }
              : structure
          ),
          hops: Arr.filter(data.hops, ({ id }) => id !== "h-pr"),
        })
      );

      const marks = compareMarks(diffMaps(current, revision));

      assert.deepStrictEqual(marks.structures.get("page"), [
        "moved",
        "resized",
      ]);
      assert.deepStrictEqual(marks.structures.get("server"), ["changed"]);
      assert.isUndefined(marks.structures.get("engineer"));
      assert.strictEqual(marks.hops.get("h-pr"), "removed");
      assert.deepStrictEqual(marks.origins.get("page"), {
        x: 4,
        y: 0,
        w: 2,
        d: 2,
      });
      assert.isUndefined(marks.origins.get("server"));
    })
  );
});

describe(ghostedMap, () => {
  it.effect("adds what only the current map has, at its current place", () =>
    Effect.gen(function* () {
      const current = yield* review;

      const revision: MapSnapshot = {
        data: {
          ...current.data,
          structures: Arr.filter(
            current.data.structures,
            ({ id }) => id !== "upstream"
          ),
          hops: Arr.filter(current.data.hops, ({ id }) => id !== "h-pr"),
        },
        layout: {
          ...current.layout,
          structures: Object.fromEntries(
            Object.entries(current.layout.structures).filter(
              ([id]) => id !== "upstream"
            )
          ),
        },
      };

      const diff = diffMaps(current, revision);

      assert.deepStrictEqual(diff.structures.removed, ["upstream"]);
      assert.deepStrictEqual(diff.hops.removed, ["h-pr"]);

      const ghosted = ghostedMap({ current, revision, diff });

      assert.deepStrictEqual([...ghosted.ghostStructures], ["upstream"]);
      assert.include(ids(ghosted.data.structures), "upstream");
      assert.deepStrictEqual([...ghosted.ghostHops], ["h-pr"]);
      assert.include(ids(ghosted.data.hops), "h-pr");
      assert.deepStrictEqual(
        ghosted.layout.structures.upstream,
        current.layout.structures.upstream
      );
      // The revision's own structures keep their own places.
      assert.deepStrictEqual(
        ghosted.layout.structures.page,
        revision.layout.structures.page
      );
    })
  );

  it.effect("keeps the revision's data untouched when nothing is ghosted", () =>
    Effect.gen(function* () {
      const map = yield* review;
      const diff = diffMaps(map, map);
      const ghosted = ghostedMap({ current: map, revision: map, diff });

      assert.strictEqual(ghosted.data, map.data);
      assert.strictEqual(ghosted.layout, map.layout);
      assert.strictEqual(ghosted.ghostStructures.size, 0);
      assert.strictEqual(ghosted.ghostHops.size, 0);
    })
  );
});

describe(describeDifferences, () => {
  it.effect("says what a restore would move, and what it can't restore", () =>
    Effect.gen(function* () {
      const current = yield* review;

      const revision = withData(
        withLayout(current, {
          page: { x: 4, y: 4, w: 2, d: 2 },
          server: { x: 8, y: 0, w: 3, d: 2 },
        }),
        (data) => ({
          ...data,
          structures: Arr.map(
            Arr.filter(data.structures, ({ id }) => id !== "upstream"),
            (structure) =>
              structure.id === "proposals"
                ? { ...structure, oneLiner: "Different." }
                : structure
          ),
          hops: Arr.filter(data.hops, ({ id }) => id !== "h-pr"),
          overview: { ...data.overview, summary: "Another." },
        })
      );

      const lines = describeDifferences({
        diff: diffMaps(current, revision),
        current: current.data,
        revision: revision.data,
        revisionName: "revision 2",
      });

      assert.deepStrictEqual(lines.layout, [
        "Map page moved from 4, 0 to 4, 4",
        "Save server resized from 2 × 2 to 3 × 2",
      ]);
      assert.deepStrictEqual(lines.meaning, [
        "Upstream atlas is in the current map, not in revision 2",
        "Proposals: one-liner differs",
        'Hop "accepted" (Proposals → Pull request) is in the current map, not in revision 2',
        "The overview differs",
      ]);
      assert.deepStrictEqual(lines.routes, []);
    })
  );
});
