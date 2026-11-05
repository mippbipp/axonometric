import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from "effect";
import { vi } from "vitest";

import {
  breakageOf,
  checkLayout,
  commitBatch,
  defaultSpotFor,
  discardProposal,
  droppedIntoGroup,
  footprintsOverlap,
  freezeOpen,
  marked,
  newProvisionalId,
  noKnownIds,
  proposalProblems,
  proposedMap,
  proposeStructure,
  removedMark,
  recordVerdict,
  reviewPrompt,
  StructureChange,
  Verdict,
} from "../src/index.ts";
import type {
  AcceptedItem,
  BatchItem,
  Layout,
  MapData,
  MapState,
  Proposals,
} from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";
import { asOf, changedAs, changedOf, unwrap } from "./review-helpers.ts";

// Seam 3: the pure functions behind structure proposals, with plain data.

vi.setConfig({ testTimeout: 5000 });

const at = "2026-11-01T09:00:00.000Z";

const structure = (
  id: string,
  extra: Partial<MapData["structures"][number]> = {}
): MapData["structures"][number] => ({
  id,
  code: "A",
  name: `Structure ${id}`,
  shape: "box",
  group: "g1",
  status: "live",
  oneLiner: "One.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
  ...extra,
});

const data: MapData = {
  format: 1,
  revision: 0,
  overview: { title: "T", summary: "S" },
  groups: [
    { id: "g1", title: "One" },
    { id: "g2", title: "Two" },
  ],
  structures: [
    structure("a", {
      questions: [{ id: "Q-A1", state: "open", text: "Why?" }],
    }),
    structure("b"),
    structure("c", { group: "g2" }),
  ],
  hops: [
    { id: "h-ab", from: "a", to: "b", label: "a to b" },
    { id: "h-bc", from: "b", to: "c", label: "b to c" },
  ],
  flows: [{ id: "f1", name: "Main flow", hops: ["h-ab", "h-bc"] }],
  chapters: [
    {
      id: "ch1",
      title: "First",
      lede: "L",
      story: "S",
      reveals: ["a", "b"],
      plays: ["h-ab"],
    },
    {
      id: "ch2",
      title: "Second",
      lede: "L",
      story: "S",
      reveals: ["c"],
      plays: ["h-bc"],
    },
  ],
};

const layout: Layout = {
  format: 1,
  revision: 1,
  structures: {
    a: { x: 0, y: 0, w: 2, d: 2 },
    b: { x: 4, y: 0, w: 2, d: 2 },
    c: { x: 8, y: 0, w: 2, d: 2 },
  },
};

const state: MapState = { system: "t", data, layout };

const empty: Proposals = { format: 1, revision: 0, layout: [] };

const add: StructureChange = {
  action: "add",
  structure: {
    id: "new-1",
    name: "Cache",
    shape: "store",
    group: "g2",
    status: "planned",
  },
  at: { x: 12, y: 0, w: 2, d: 2 },
};

const withStructures = (
  ...structures: readonly (readonly [string, StructureChange])[]
): Proposals => ({
  ...empty,
  structures: Arr.map(structures, ([id, change]) => ({ id, change })),
});

const item = (id: string, change: StructureChange): BatchItem => ({
  id,
  kind: "structure",
  change,
});

const world = { data, layout };

const proposed = (change: StructureChange) =>
  proposedMap({ state, proposals: withStructures(["p1", change]) });

/** The structures the first chapter reveals in the proposed map. */
const revealedFirst = (
  shown: ReturnType<typeof proposedMap>
): readonly string[] =>
  Option.match(Arr.head(shown.state.data.chapters), {
    onNone: () => [],
    onSome: ({ reveals }) => reveals,
  });

/** The structures the proposal `id` touches. */
const touchedBy = (
  shown: ReturnType<typeof proposedMap>,
  id: string
): readonly string[] =>
  Option.match(Option.fromNullishOr(shown.touches.get(id)), {
    onNone: () => [],
    onSome: ({ structures }) => structures,
  });

/** The first structure proposal's change, which must be an add. */
const addedBy = (proposals: Proposals) => {
  const change = proposals.structures?.[0]?.change;

  assert.strictEqual(change?.action, "add");

  return change?.action === "add" ? change : add;
};

/** The structure item in a revision's accepted list. */
const structureEntry = (entries: readonly AcceptedItem[]) => {
  const entry = Arr.findFirst(entries, ({ kind }) => kind === "structure");

  assert.isTrue(Option.isSome(entry));

  return entry.pipe(Option.getOrThrow);
};

const targetOf = (entry: AcceptedItem) =>
  "target" in entry && "id" in entry.target ? entry.target.id : "";

/** What `build` does: a structure with no saved position is placed. */
const placedLike = (nextData: MapData, saved: Layout): Layout => ({
  ...saved,
  structures: {
    ...Rec.fromEntries(
      Arr.map(
        Arr.filter(
          nextData.structures,
          (s) => saved.structures[s.id] === undefined
        ),
        (s): readonly [string, Layout["structures"][string]] => [
          s.id,
          { x: 20, y: 20, w: 2, d: 2 },
        ]
      )
    ),
    ...saved.structures,
  },
});

const withNew = (id: string): MapData => ({
  ...data,
  structures: [...data.structures, structure(id)],
});

const committed = (verdict: Verdict, nextData: MapData, saved = layout) => {
  const frozen = unwrap(verdictOn(frozenWith(add), "p1", verdict));

  return commitBatch({
    proposals: frozen,
    layout: placedLike(nextData, saved),
    saved,
    data: nextData,
    hops: nextData.hops,
    revision: 2,
    at,
  });
};

const droppedAt = (id: string, x: number, y: number) =>
  droppedIntoGroup({ data, layout, id, at: { x, y, w: 2, d: 2 } });

const refusedBy = (change: StructureChange) =>
  Result.merge(proposeStructure({ proposals: empty, id: "p1", change, world }));

const breakageWithout = (patch: Partial<MapData>) =>
  Option.getOrThrow(
    breakage(
      { action: "delete", structure: "b" },
      { ...data, hops: [], flows: [], chapters: [], ...patch }
    )
  );

const decodeChange = Schema.decodeUnknownResult(StructureChange);

/** A placement the add form could send, for the cap test. */
interface Spot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

const addAt = (spot: Spot) => decodeChange({ ...add, at: spot });

/** The batch of adds `ids` names, frozen, with item ids `p-<id>`. */
const frozenAddsOf = (ids: readonly string[]): Proposals => {
  const changes = Arr.map(ids, (id): readonly [string, StructureChange] => [
    `p-${id}`,
    { ...add, structure: { ...add.structure, id } },
  ]);

  const open = withStructures(...changes);

  return unwrap(freezeOpen({ proposals: open, at })).proposals;
};

/** How far a spot is from the left edge of group g2's structure b, by taxicab. */
const distanceFromB = (spot: Spot) => Math.abs(spot.x - 8) + Math.abs(spot.y);

const distanceFrom = (spot: Spot, x: number) =>
  Math.abs(spot.x - x) + Math.abs(spot.y);

describe("the proposed map, for each structure action", () => {
  it("adds a new structure with its footprint, and leaves the chapters' reveals alone", () => {
    const shown = proposed(add);

    const made = Arr.findFirst(
      shown.state.data.structures,
      (s) => s.id === "new-1"
    ).pipe(Option.getOrUndefined);

    assert.strictEqual(made?.name, "Cache");
    assert.strictEqual(made?.shape, "store");
    assert.strictEqual(made?.group, "g2");
    assert.strictEqual(made?.status, "planned");
    assert.deepStrictEqual(shown.state.layout.structures["new-1"], add.at);
    // Chapter data is left alone: the page shows a proposed add in every chapter.
    assert.notInclude(revealedFirst(shown), "new-1");
    assert.deepStrictEqual([...shown.structures], ["new-1"]);
    assert.deepStrictEqual([...touchedBy(shown, "p1")], ["new-1"]);
    assert.strictEqual(marked(shown, removedMark).size, 0);
  });

  it("keeps a deleted structure on the map and lists it as removed", () => {
    const shown = proposed({ action: "delete", structure: "b" });

    assert.isTrue(Arr.some(shown.state.data.structures, (s) => s.id === "b"));
    assert.deepStrictEqual([...marked(shown, removedMark)], ["b"]);
    assert.deepStrictEqual([...shown.structures], ["b"]);
  });

  it("renames, reshapes, regroups and changes the status of a structure", () => {
    const find = (shown: ReturnType<typeof proposed>, id: string) =>
      Option.getOrUndefined(
        Arr.findFirst(shown.state.data.structures, (s) => s.id === id)
      );

    assert.strictEqual(
      find(proposed({ action: "rename", structure: "a", name: "Gate" }), "a")
        ?.name,
      "Gate"
    );
    assert.strictEqual(
      find(proposed({ action: "shape", structure: "a", shape: "tall" }), "a")
        ?.shape,
      "tall"
    );
    assert.strictEqual(
      find(proposed({ action: "group", structure: "a", group: "g2" }), "a")
        ?.group,
      "g2"
    );
    assert.strictEqual(
      find(proposed({ action: "status", structure: "a", status: "off" }), "a")
        ?.status,
      "off"
    );
  });

  it("leaves the accepted state alone", () => {
    proposed(add);
    assert.strictEqual(data.structures.length, 3);
    assert.isUndefined(layout.structures["new-1"]);
  });

  it("applies a frozen proposal and an open one on top of it", () => {
    const frozen: Proposals = {
      ...empty,
      batches: [
        {
          number: 1,
          frozenAt: at,
          items: [item("f1", add)],
          verdicts: {},
        },
      ],
      structures: [
        {
          id: "o1",
          change: { action: "rename", structure: "b", name: "Bee" },
        },
      ],
    };

    const shown = proposedMap({ state, proposals: frozen });

    assert.isTrue(
      Arr.some(shown.state.data.structures, (s) => s.id === "new-1")
    );
    assert.strictEqual(
      Option.getOrUndefined(
        Arr.findFirst(shown.state.data.structures, (s) => s.id === "b")
      )?.name,
      "Bee"
    );
    assert.deepStrictEqual(
      [...proposedMap({ state, proposals: frozen, open: false }).structures],
      ["new-1"]
    );
  });

  it("ignores a batch a commit has closed", () => {
    const closed: Proposals = {
      ...empty,
      batches: [
        {
          number: 1,
          frozenAt: at,
          items: [item("f1", add)],
          verdicts: { f1: { verdict: "accepted" } },
          committed: { revision: 2, at },
        },
      ],
    };

    assert.isFalse(
      Arr.some(
        proposedMap({ state, proposals: closed }).state.data.structures,
        (s) => s.id === "new-1"
      )
    );
  });

  it("adds a layout change on a proposed structure after the structure", () => {
    const proposals: Proposals = {
      ...withStructures(["p1", add]),
      layout: [
        {
          id: "m1",
          kind: "move",
          moves: [
            {
              target: { kind: "structure", id: "new-1" },
              position: { x: 16, y: 0 },
            },
          ],
        },
      ],
    };

    assert.deepStrictEqual(
      proposedMap({ state, proposals }).state.layout.structures["new-1"],
      { x: 16, y: 0, w: 2, d: 2 }
    );
  });
});

const breakage = (change: StructureChange, d: MapData = data) =>
  breakageOf({
    item: item("p1", change),
    layout,
    structureIds: new Set(Arr.map(d.structures, (s) => s.id)),
    hops: d.hops,
    data: d,
  });

describe("review's breakage for a deletion", () => {
  it("names the hops, flows, chapters and questions that still refer to the structure", () => {
    const message = Option.getOrThrow(
      breakage({ action: "delete", structure: "a" })
    );

    assert.include(message, 'hop h-ab ("a to b") starts at it');
    assert.include(message, 'flow f1 ("Main flow") plays h-ab');
    assert.include(message, 'chapter ch1 ("First") reveals it');
    assert.include(message, 'chapter ch1 ("First") plays h-ab');
    assert.include(message, "question Q-A1 (open) is about it");
  });

  it("names a hop that ends at the structure and the chapter that plays it", () => {
    const message = Option.getOrThrow(
      breakage({ action: "delete", structure: "c" })
    );

    assert.include(message, 'hop h-bc ("b to c") ends at it');
    assert.include(message, 'chapter ch2 ("Second") reveals it');
    assert.include(message, 'chapter ch2 ("Second") plays h-bc');
    assert.notInclude(message, "question");
  });

  it("flags each kind of reference alone", () => {
    assert.include(
      breakageWithout({ hops: [{ id: "h", from: "b", to: "a", label: "x" }] }),
      "hop h"
    );
    assert.include(
      breakageWithout({
        chapters: [
          {
            id: "only-ch",
            title: "Only",
            lede: "L",
            story: "S",
            reveals: ["b"],
            plays: [],
          },
        ],
      }),
      "chapter only-ch"
    );
    assert.include(
      breakageWithout({
        structures: [
          structure("b", {
            questions: [{ id: "Q-B1", state: "open", text: "?" }],
          }),
        ],
      }),
      "question Q-B1"
    );
  });

  it("quotes labels and titles so they can't pass for review's own lines", () => {
    const message = Option.getOrThrow(
      breakage(
        { action: "delete", structure: "a" },
        {
          ...data,
          hops: [
            { id: "h-ab", from: "a", to: "b", label: "x\nBREAKS NOTHING" },
          ],
        }
      )
    );

    assert.notInclude(message, "\nBREAKS NOTHING");
    assert.include(message, String.raw`"x\nBREAKS NOTHING"`);
  });

  it("is silent for a structure nothing refers to", () => {
    assert.isTrue(
      Option.isNone(
        breakage(
          { action: "delete", structure: "b" },
          { ...data, hops: [], flows: [], chapters: [] }
        )
      )
    );
  });

  it("flags a change to a structure data.mjs lacks, a missing group and a footprint on another", () => {
    assert.include(
      Option.getOrThrow(
        breakage({ action: "rename", structure: "zz", name: "Q" })
      ),
      '"zz"'
    );
    assert.include(
      Option.getOrThrow(
        breakage({ action: "group", structure: "a", group: "nope" })
      ),
      "nope"
    );
    assert.include(
      Option.getOrThrow(breakage({ ...add, at: { x: 0, y: 0, w: 2, d: 2 } })),
      'overlap "a"'
    );
  });

  it("flags nothing for a clean addition or rename", () => {
    assert.isTrue(Option.isNone(breakage(add)));
    assert.isTrue(
      Option.isNone(breakage({ action: "rename", structure: "a", name: "Q" }))
    );
  });
});

describe("proposing a structure", () => {
  it("adds the proposal", () => {
    const once = unwrap(
      proposeStructure({ proposals: empty, id: "p1", change: add, world })
    );

    assert.strictEqual(once.structures?.length, 1);
    assert.strictEqual(once.revision, 1);
  });

  it("refuses an unknown group, a taken id, a footprint on another and a rename of an unknown structure", () => {
    assert.include(
      refusedBy({ ...add, structure: { ...add.structure, group: "nope" } }),
      "nope"
    );
    assert.include(
      refusedBy({ ...add, structure: { ...add.structure, id: "a" } }),
      "already has"
    );
    assert.include(
      refusedBy({ ...add, at: { x: 1, y: 1, w: 2, d: 2 } }),
      "overlap"
    );
    assert.include(
      refusedBy({ action: "rename", structure: "zz", name: "Q" }),
      '"zz"'
    );
  });

  it("edits the proposal of a new structure instead of adding another", () => {
    const first = unwrap(
      proposeStructure({ proposals: empty, id: "p1", change: add, world })
    );

    const renamed = unwrap(
      proposeStructure({
        proposals: first,
        id: "p2",
        change: { action: "rename", structure: "new-1", name: "Cache 2" },
        world,
      })
    );

    assert.strictEqual(renamed.structures?.length, 1);
    assert.strictEqual(addedBy(renamed).structure.name, "Cache 2");
  });

  it("drops the proposal of a new structure when it is deleted", () => {
    const first = unwrap(
      proposeStructure({ proposals: empty, id: "p1", change: add, world })
    );

    const gone = unwrap(
      proposeStructure({
        proposals: first,
        id: "p2",
        change: { action: "delete", structure: "new-1" },
        world,
      })
    );

    assert.deepStrictEqual(gone.structures, []);
  });

  it("keeps one proposal per structure and action, and drops it when the value is back", () => {
    const renamed = unwrap(
      proposeStructure({
        proposals: empty,
        id: "p1",
        change: { action: "rename", structure: "a", name: "One" },
        world,
      })
    );

    const again = unwrap(
      proposeStructure({
        proposals: renamed,
        id: "p2",
        change: { action: "rename", structure: "a", name: "Two" },
        world,
      })
    );

    assert.strictEqual(again.structures?.length, 1);
    assert.strictEqual(again.structures?.[0]?.id, "p1");

    const back = unwrap(
      proposeStructure({
        proposals: again,
        id: "p3",
        change: { action: "rename", structure: "a", name: "Structure a" },
        world,
      })
    );

    assert.deepStrictEqual(back.structures, []);
  });

  it("moves a proposed structure by setting its own proposal again", () => {
    const first = unwrap(
      proposeStructure({ proposals: empty, id: "p1", change: add, world })
    );

    const moved = unwrap(
      proposeStructure({
        proposals: first,
        id: "p1",
        change: { ...add, at: { x: 16, y: 0, w: 2, d: 2 } },
        world: {
          data,
          layout: proposedMap({ state, proposals: first }).state.layout,
        },
      })
    );

    assert.deepStrictEqual(addedBy(moved).at, { x: 16, y: 0, w: 2, d: 2 });
  });

  it("discards an open proposal, and refuses once it is frozen", () => {
    const first = unwrap(
      proposeStructure({ proposals: empty, id: "p1", change: add, world })
    );

    assert.deepStrictEqual(
      unwrap(discardProposal({ proposals: first, id: "p1" })).structures,
      []
    );

    const frozen = unwrap(freezeOpen({ proposals: first, at })).proposals;

    assert.include(
      Result.merge(discardProposal({ proposals: frozen, id: "p1" })),
      "waiting for the agent"
    );
    assert.include(
      Result.merge(
        proposeStructure({
          proposals: frozen,
          id: "p2",
          change: { action: "rename", structure: "new-1", name: "X" },
          world,
        })
      ),
      "waiting for the agent"
    );
  });
});

const frozenWith = (change: StructureChange): Proposals =>
  unwrap(
    freezeOpen({
      proposals: withStructures(["p1", change]),
      at,
    })
  ).proposals;

const verdictOn = (
  proposals: Proposals,
  id: string,
  verdict: Verdict
): Result.Result<Proposals, string> =>
  recordVerdict({ proposals, id, verdict });

describe("a verdict of changed with --as", () => {
  it("is kept on the verdict, and refused on an item that adds no structure", () => {
    const frozen = frozenWith(add);

    const changed: Verdict = {
      verdict: "changed",
      reason: "Named cache.",
      as: "cache",
    };

    const recorded = unwrap(verdictOn(frozen, "p1", changed));

    assert.deepStrictEqual(recorded.batches?.[0]?.verdicts.p1, changed);

    const rename = frozenWith({ action: "delete", structure: "b" });

    assert.include(
      Result.merge(verdictOn(rename, "p1", changed)),
      "does not add a structure"
    );
  });
});

describe("committing a new structure", () => {
  it("refuses an accepted add while data.mjs lacks the structure", () => {
    const result = committed({ verdict: "accepted" }, data);

    assert.include(Result.merge(result), '"new-1"');
    assert.include(Result.merge(result), "--as");
  });

  it("moves the structure to where it was dropped, under its provisional id", () => {
    const done = unwrap(committed({ verdict: "accepted" }, withNew("new-1")));

    assert.deepStrictEqual(done.layout.structures["new-1"], add.at);
    assert.isUndefined(asOf(structureEntry(done.accepted)));
  });

  it("writes the position under the final id the verdict gave, and the revision records it", () => {
    const done = unwrap(
      committed(
        { verdict: "changed", reason: "Called it cache.", as: "cache" },
        withNew("cache")
      )
    );

    assert.deepStrictEqual(done.layout.structures.cache, add.at);
    assert.isUndefined(done.layout.structures["new-1"]);

    const entry = structureEntry(done.accepted);

    assert.strictEqual(asOf(entry), "cache");
    assert.isTrue(changedOf(entry));
  });

  it("leaves the position alone when the agent placed the structure itself", () => {
    const done = unwrap(
      committed(
        { verdict: "changed", reason: "Placed by hand.", as: "cache" },
        withNew("cache"),
        {
          ...layout,
          structures: {
            ...layout.structures,
            cache: { x: 30, y: 30, w: 2, d: 2 },
          },
        }
      )
    );

    assert.deepStrictEqual(done.layout.structures.cache, {
      x: 30,
      y: 30,
      w: 2,
      d: 2,
    });
  });

  it("records a rejected add without needing the structure", () => {
    const done = unwrap(
      committed({ verdict: "rejected", reason: "No cache." }, data)
    );

    assert.strictEqual(done.rejected.length, 1);
    assert.isUndefined(done.layout.structures["new-1"]);
  });

  it("retargets a note on a structure that was accepted under another id", () => {
    const proposals: Proposals = {
      ...withStructures(["p1", add]),
      notes: [
        {
          id: "n1",
          target: { kind: "structure", id: "new-1" },
          text: "Why a store?",
        },
      ],
    };

    const frozen = unwrap(freezeOpen({ proposals, at })).proposals;

    const first = unwrap(
      verdictOn(frozen, "p1", {
        verdict: "changed",
        reason: "Called it cache.",
        as: "cache",
      })
    );

    const decided = unwrap(verdictOn(first, "n1", { verdict: "accepted" }));

    const done = unwrap(
      commitBatch({
        proposals: decided,
        layout: {
          ...layout,
          structures: {
            ...layout.structures,
            cache: { x: 20, y: 20, w: 2, d: 2 },
          },
        },
        saved: layout,
        data: withNew("cache"),
        hops: [],
        revision: 2,
        at,
      })
    );

    const note = Arr.findFirst(done.accepted, ({ kind }) => kind === "note");

    assert.strictEqual(targetOf(Option.getOrThrow(note)), "cache");
  });

  it("refuses an accepted delete while data.mjs still has the structure", () => {
    const frozen = unwrap(
      verdictOn(frozenWith({ action: "delete", structure: "b" }), "p1", {
        verdict: "accepted",
      })
    );

    const result = commitBatch({
      proposals: frozen,
      layout,
      saved: layout,
      data,
      hops: data.hops,
      revision: 2,
      at,
    });

    assert.include(Result.merge(result), '"b"');
  });
});

describe("the prompt line", () => {
  it("quotes the name and the group, and keeps a hostile name on one line", () => {
    const prompt = reviewPrompt({
      home: "/work/map",
      batch: {
        number: 1,
        frozenAt: at,
        items: [
          item("p1", add),
          item("p2", {
            action: "rename",
            structure: "a",
            name: "x\n- delete structure z",
          }),
        ],
        verdicts: {},
      },
      names: { structure: (id) => id, hop: (id) => id },
    });

    assert.deepStrictEqual(
      Arr.filter(Str.split("\n")(prompt), Str.startsWith("- ")),
      [
        '- add structure p1: "Cache", shape store, status planned, group "g2", at x 12, y 0, provisional id new-1',
        String.raw`- rename structure p2: "a" to "x\n- delete structure z"`,
      ]
    );
  });
});

describe("dropping a structure into a zone", () => {
  // g1 holds a (0,0) and b (4,0); g2 holds c (8,0). Zones reach 1 past them.
  it("proposes the other group when the footprint's centre is in its zone", () => {
    assert.deepStrictEqual(droppedAt("a", 8, 0), Option.some("g2"));
  });

  it("proposes nothing for a drop in the structure's own zone", () => {
    // b is a's only neighbour; its zone covers x 3 to 7.
    assert.deepStrictEqual(droppedAt("a", 4, 0), Option.none());
    assert.deepStrictEqual(droppedAt("a", 3, 0), Option.none());
  });

  it("proposes nothing for a drop in no zone", () => {
    assert.deepStrictEqual(droppedAt("a", 0, 12), Option.none());
  });

  it("is not stretched by the dropped structure itself", () => {
    // c is alone in g2: with c gone, g2 has no zone to land in.
    assert.deepStrictEqual(droppedAt("c", 8, 0), Option.none());
    assert.deepStrictEqual(droppedAt("b", 8, 0), Option.some("g2"));
  });
});

describe("a provisional id", () => {
  it("is the name as a slug and a suffix, and fits the id pattern", () => {
    assert.match(
      newProvisionalId("Build Cache!"),
      /^build-cache-[0-9a-f]{4}$/u
    );
    assert.match(newProvisionalId("  "), /^structure-[0-9a-f]{4}$/u);
    assert.match(newProvisionalId(Str.repeat(100)("x")), /^[\w-]{1,64}$/u);
  });
});

describe("a code for a proposed structure", () => {
  it("is one to three capitals that no other structure on the map has", () => {
    const shown = proposedMap({
      state: {
        ...state,
        data: {
          ...data,
          structures: [
            structure("a", { code: "BC" }),
            ...data.structures.slice(1),
          ],
        },
      },
      proposals: withStructures([
        "p1",
        { ...add, structure: { ...add.structure, name: "Build Cache" } },
      ]),
    });

    const codes = Arr.map(shown.state.data.structures, ({ code }) => code);

    const made = Arr.findFirst(
      shown.state.data.structures,
      (s) => s.id === "new-1"
    );

    const { code } = Option.getOrThrow(made);

    assert.match(code, /^[A-Z]{1,3}$/u);
    assert.lengthOf(
      Arr.filter(codes, (other) => other === code),
      1,
      `${code} is taken`
    );
  });
});

describe("what a proposed structure may hold", () => {
  it.each(["\n", "\r", "\u0085", "\u2028", "\u2029"])(
    "refuses line break %j in a name and in a group",
    (mark) => {
      assert.isTrue(
        Result.isFailure(
          decodeChange({ action: "rename", structure: "a", name: `A${mark}B` })
        )
      );
      assert.isTrue(
        Result.isFailure(
          decodeChange({ action: "group", structure: "a", group: `g${mark}` })
        )
      );
    }
  );

  it("caps where an add lands and how big it is", () => {
    assert.isTrue(Result.isSuccess(addAt({ x: 1000, y: -1000, w: 10, d: 10 })));
    assert.isTrue(Result.isFailure(addAt({ x: 1000.5, y: 0, w: 2, d: 2 })));
    assert.isTrue(Result.isFailure(addAt({ x: 0, y: -1001, w: 2, d: 2 })));
    assert.isTrue(Result.isFailure(addAt({ x: 0, y: 0, w: 11, d: 2 })));
    assert.isTrue(Result.isFailure(addAt({ x: 0, y: 0, w: 2, d: 10.5 })));
  });
});

describe("--as", () => {
  it("is an id of letters, digits, - and _", () => {
    const decode = Schema.decodeUnknownResult(Verdict);

    const results = Arr.map(["build-cache_2", "a b", "a\nb", ""], (as) =>
      Result.isSuccess(decode(changedAs(as)))
    );

    assert.deepStrictEqual(results, [true, false, false, false]);
  });

  it("is refused when it names a structure the accepted map already has", () => {
    const refused = recordVerdict({
      proposals: frozenAddsOf(["n1"]),
      id: "p-n1",
      verdict: changedAs("b"),
      accepted: { ...noKnownIds, structure: new Set(["a", "b", "c"]) },
    });

    assert.include(Result.merge(refused), "already has");

    const allowed = recordVerdict({
      proposals: frozenAddsOf(["n1"]),
      id: "p-n1",
      verdict: changedAs("fresh"),
      accepted: { ...noKnownIds, structure: new Set(["a", "b", "c"]) },
    });

    assert.isTrue(Result.isSuccess(allowed));
  });

  it("is refused when another item in the batch has it", () => {
    const first = unwrap(
      recordVerdict({
        proposals: frozenAddsOf(["n1", "n2"]),
        id: "p-n1",
        verdict: changedAs("cache"),
      })
    );

    const refused = recordVerdict({
      proposals: first,
      id: "p-n2",
      verdict: changedAs("cache"),
    });

    assert.include(Result.merge(refused), "item p-n1");

    // The same item may be given its verdict again.
    const again = recordVerdict({
      proposals: first,
      id: "p-n1",
      verdict: changedAs("cache"),
    });

    assert.isTrue(Result.isSuccess(again));
  });
});

describe("the structures a batch is frozen against", () => {
  it("are recorded at freeze and win over the ids the caller passes", () => {
    const frozen = unwrap(
      freezeOpen({
        proposals: withStructures(["p1", add]),
        at,
        known: { structure: ["a", "b"] },
      })
    ).proposals;

    assert.deepStrictEqual(frozen.batches?.[0]?.structures, ["a", "b"]);

    // "a" is on the frozen list, so --as a is refused whatever else is passed.
    const refused = recordVerdict({
      proposals: frozen,
      id: "p1",
      verdict: changedAs("a"),
      accepted: noKnownIds,
    });

    assert.include(Result.merge(refused), "already has");

    // An id that is not on it is allowed, even if the caller's set has it.
    const allowed = recordVerdict({
      proposals: frozen,
      id: "p1",
      verdict: changedAs("fresh"),
      accepted: { ...noKnownIds, structure: new Set(["fresh"]) },
    });

    assert.isTrue(Result.isSuccess(allowed));
  }, 5000);

  it("are left out of a batch frozen without them, and the check falls back to the caller's set", () => {
    const frozen = unwrap(
      freezeOpen({ proposals: withStructures(["p1", add]), at })
    ).proposals;

    assert.isUndefined(frozen.batches?.[0]?.structures);

    // With no list in the batch, the caller's set is what --as is checked against.
    const refused = recordVerdict({
      proposals: frozen,
      id: "p1",
      verdict: changedAs("b"),
      accepted: { ...noKnownIds, structure: new Set(["b"]) },
    });

    assert.include(Result.merge(refused), "already has");
  }, 5000);
});

/** A map with three groups in a row, each a zone with room between. */
const rowData: MapData = {
  ...data,
  groups: [
    { id: "g1", title: "One" },
    { id: "g2", title: "Two" },
    { id: "g3", title: "Three" },
  ],
  structures: [
    structure("a", { group: "g1" }),
    structure("b", { group: "g2" }),
    structure("c", { group: "g3" }),
  ],
  hops: [],
  flows: [],
  chapters: [],
};

const rowLayout: Layout = {
  ...layout,
  structures: {
    a: { x: 0, y: 0, w: 2, d: 2 },
    b: { x: 8, y: 0, w: 2, d: 2 },
    c: { x: 16, y: 0, w: 2, d: 2 },
  },
};

const candidate = (...changes: readonly StructureChange[]) =>
  proposalProblems({
    before: { data: rowData, layout: rowLayout },
    items: Arr.map(changes, (change, index) => item(`p${index}`, change)),
  });

const zoneWarnings = (found: ReturnType<typeof candidate>) =>
  Arr.filter(found, ({ problem }) =>
    Str.includes("zones of groups")(problem.message)
  );

describe("what a proposal would add to check's report", () => {
  it("is silent for a structure placed inside its own group's zone", () => {
    const found = candidate({
      ...add,
      structure: { ...add.structure, group: "g1" },
      at: { x: 4, y: 0, w: 2, d: 2 },
    });

    assert.deepStrictEqual(zoneWarnings(found), []);
  });

  it("reports a zone that a new structure stretches over another group's, marked new", () => {
    const found = candidate({
      ...add,
      structure: { ...add.structure, group: "g1" },
      at: { x: 20, y: 0, w: 2, d: 2 },
    });

    const [warning] = zoneWarnings(found);

    assert.deepStrictEqual(
      Option.map(Option.fromNullishOr(warning), ({ added }) => added),
      Option.some(true)
    );
    assert.deepStrictEqual(
      Option.map(Option.fromNullishOr(warning), ({ problem }) =>
        Str.includes('"g1"')(problem.message)
      ),
      Option.some(true)
    );
  });

  it("reports the zone a group change grows or makes overlap, which a drag never checked", () => {
    const found = candidate({ action: "group", structure: "a", group: "g3" });

    assert.isAbove(zoneWarnings(found).length, 0);
    assert.isTrue(Arr.every(zoneWarnings(found), ({ added }) => added));
  });

  it("does not mark a problem the map already had", () => {
    const crowded: Layout = {
      ...rowLayout,
      structures: { ...rowLayout.structures, b: { x: 3, y: 0, w: 2, d: 2 } },
    };

    const found = proposalProblems({
      before: { data: rowData, layout: crowded },
      items: [item("p1", { action: "rename", structure: "a", name: "Alpha" })],
    });

    assert.isTrue(Arr.every(found, ({ added }) => !added));
  });
});

const spotFor = (group: string, mapData = rowData, map = rowLayout) =>
  defaultSpotFor({
    data: mapData,
    layout: map,
    group,
    shape: "box",
    name: "New",
  });

describe("the default spot for a new structure", () => {
  it("is a free 2 by 2 slot beside the group's zone, clear of every footprint", () => {
    const { spot } = spotFor("g2");

    assert.deepStrictEqual({ w: spot.w, d: spot.d }, { w: 2, d: 2 });
    assert.isTrue(
      Arr.every(
        Rec.values(rowLayout.structures),
        (other) => !footprintsOverlap(spot, other)
      )
    );
    // Beside g2's zone: nearer to b than to a or c.
    assert.isBelow(distanceFromB(spot), distanceFrom(spot, 0));
    assert.isBelow(distanceFromB(spot), distanceFrom(spot, 16));
  });

  it("changes with the group, and starts a group with no structures clear of the rest", () => {
    assert.notDeepEqual(spotFor("g1").spot, spotFor("g3").spot);

    const { spot } = spotFor("g4", {
      ...rowData,
      groups: [...rowData.groups, { id: "g4", title: "Four" }],
    });

    assert.isTrue(
      Arr.every(
        Rec.values(rowLayout.structures),
        (other) => !footprintsOverlap(spot, other)
      )
    );
  });

  it("takes the spot that adds the fewest warnings when none adds nothing, and says how many", () => {
    // Four other groups hem g1 in on every side, so any spot beside a
    // stretches g1's zone over at least one of theirs.
    const walls = ["g2", "g3", "g4", "g5"];

    const walled: MapData = {
      ...rowData,
      groups: [
        { id: "g1", title: "One" },
        ...Arr.map(walls, (id) => ({ id, title: id })),
      ],
      structures: [
        structure("a", { group: "g1" }),
        ...Arr.map(walls, (group) => structure(group, { group })),
      ],
    };

    const map: Layout = {
      ...layout,
      structures: {
        a: { x: 0, y: 0, w: 2, d: 2 },
        g2: { x: 0, y: 4, w: 2, d: 2 },
        g3: { x: 0, y: -4, w: 2, d: 2 },
        g4: { x: -4, y: 0, w: 2, d: 2 },
        g5: { x: 4, y: 0, w: 2, d: 2 },
      },
    };

    const { spot, added } = spotFor("g1", walled, map);

    assert.strictEqual(added, 1);
    assert.lengthOf(
      newWarnings({ mapData: walled, map, group: "g1", spot }),
      1
    );
  }, 60_000);
});

const lineOf = ({ path, message }: { path: string; message: string }) =>
  `${path}: ${message}`;

/** What `check` reports for the map with a new box in `group` at `spot` that it didn't before. */
const newWarnings = ({
  mapData,
  map,
  group,
  spot,
}: {
  readonly mapData: MapData;
  readonly map: Layout;
  readonly group: string;
  readonly spot: Spot;
}) => {
  const before = new Set(Arr.map(checkLayout(mapData, map), lineOf));

  const shown = proposedMap({
    state: { system: "t", data: mapData, layout: map },
    proposals: withStructures([
      "p1",
      {
        ...add,
        structure: { ...add.structure, name: "New", shape: "box", group },
        at: spot,
      },
    ]),
  });

  return Arr.filter(
    Arr.map(checkLayout(shown.state.data, shown.state.layout), lineOf),
    (line) => !before.has(line)
  );
};

describe("the default spot, on the row map and the review map", () => {
  it.effect(
    "adds no warning for any group, and lands clear of every footprint",
    () =>
      Effect.gen(function* () {
        const review = yield* fixture("review");

        for (const [name, mapData, map] of [
          ["row", rowData, rowLayout],
          ["review", review.data, review.layout],
        ] as const) {
          for (const { id } of mapData.groups) {
            const { spot, added } = spotFor(id, mapData, map);
            const where = `${name} ${id}`;

            assert.strictEqual(added, 0, where);
            assert.deepStrictEqual(
              newWarnings({ mapData, map, group: id, spot }),
              [],
              where
            );
            assert.isTrue(
              Arr.every(
                Rec.values(map.structures),
                (other) => !footprintsOverlap(spot, other)
              ),
              where
            );
          }
        }
      }),
    30_000
  );
});
