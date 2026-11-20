import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Match,
  Option,
  Result,
  Schema,
  String as Str,
} from "effect";

import {
  breakageOf,
  GroupWrite,
  bySection,
  commitBatch,
  freezeOpen,
  groupMark,
  chapterMarkName,
  marked,
  proposedMap,
  proposeChapter,
  proposeGroupWithMembers,
  recordVerdict,
  specOf,
} from "../src/index.ts";
import type {
  AcceptedItem,
  BatchItem,
  ChapterChange,
  GroupChange,
  Layout,
  MapData,
  MapState,
  Proposals,
  Verdict,
} from "../src/index.ts";
import { promptLine, promptLines, unwrap } from "./review-helpers.ts";

// Seam 3: the pure functions behind group and chapter proposals, with plain
// data.

const at = "2026-11-01T09:00:00.000Z";

const structure = (
  id: string,
  extra: Partial<MapData["structures"][number]> = {}
): MapData["structures"][number] => ({
  code: "A",
  group: "g1",
  howItsBuilt: "Built.",
  id,
  name: `Structure ${id}`,
  oneLiner: "One.",
  shape: "box",
  status: "live",
  whatItDoes: "Does.",
  ...extra,
});

const data: MapData = {
  chapters: [
    {
      id: "ch1",
      lede: "L",
      plays: ["h-ab"],
      reveals: ["a", "b"],
      story: "S",
      title: "First",
    },
    {
      id: "ch2",
      lede: "L",
      plays: ["h-bc", "h-ca"],
      reveals: ["c"],
      story: "S",
      title: "Second",
    },
  ],
  flows: [],
  format: 1,
  groups: [
    { id: "g1", title: "One" },
    { id: "g2", title: "Two" },
  ],
  hops: [
    { from: "a", id: "h-ab", label: "a to b", to: "b" },
    { from: "b", id: "h-bc", label: "b to c", to: "c" },
    { from: "c", id: "h-ca", label: "c to a", to: "a" },
  ],
  overview: { summary: "S", title: "T" },
  revision: 0,
  structures: [structure("a"), structure("b"), structure("c", { group: "g2" })],
};

const layout: Layout = {
  format: 1,
  revision: 1,
  structures: {
    a: { d: 2, w: 2, x: 0, y: 0 },
    b: { d: 2, w: 2, x: 4, y: 0 },
    c: { d: 2, w: 2, x: 8, y: 0 },
  },
};

const state: MapState = { data, layout, system: "t" };

const empty: Proposals = { format: 1, layout: [], revision: 0 };

const withGroups = (
  ...groups: ReadonlyArray<readonly [string, GroupChange]>
): Proposals => ({
  ...empty,
  groups: Arr.map(groups, ([id, change]) => ({ change, id })),
});

const withChapters = (
  ...chapters: ReadonlyArray<readonly [string, ChapterChange]>
): Proposals => ({
  ...empty,
  chapters: Arr.map(chapters, ([id, change]) => ({ change, id })),
});

const addGroup: GroupChange = {
  action: "add",
  group: { id: "data-1", title: "Data" },
};

const renameGroup: GroupChange = {
  action: "rename",
  group: "g1",
  title: "Front",
};

const chapterOf = (shown: ReturnType<typeof proposedMap>, id: string) =>
  Arr.findFirst(shown.state.data.chapters, (chapter) => chapter.id === id).pipe(
    Option.getOrThrow
  );

const groupItem = (id: string, change: GroupChange): BatchItem => ({
  change,
  id,
  kind: "group",
});

const chapterItem = (id: string, change: ChapterChange): BatchItem => ({
  change,
  id,
  kind: "chapter",
});

const names = {
  chapter: (id: string) =>
    Arr.findFirst(data.chapters, (chapter) => chapter.id === id).pipe(
      Option.match({ onNone: () => id, onSome: ({ title }) => title })
    ),
  group: (id: string) =>
    Arr.findFirst(data.groups, (group) => group.id === id).pipe(
      Option.match({ onNone: () => id, onSome: ({ title }) => title })
    ),
  hop: (id: string) =>
    Arr.findFirst(data.hops, (hop) => hop.id === id).pipe(
      Option.match({ onNone: () => id, onSome: ({ label }) => label })
    ),
  structure: (id: string) =>
    Arr.findFirst(data.structures, (s) => s.id === id).pipe(
      Option.match({ onNone: () => id, onSome: ({ name }) => name })
    ),
};

const breakage = (
  item: BatchItem,
  siblings: ReadonlyArray<BatchItem> = [item],
  map: MapData = data
) =>
  breakageOf({
    data: map,
    hops: map.hops,
    item,
    layout,
    siblings,
    structureIds: new Set(Arr.map(map.structures, ({ id }) => id)),
  });

const change = (kind: ChapterChange): ChapterChange => kind;

/** The ids of a list of open proposals. */
const idsOf = (held: ReadonlyArray<{ readonly id: string }> | undefined) =>
  Arr.map(
    Option.fromNullishOr(held).pipe(Option.getOrElse(() => [])),
    ({ id }) => id
  );

/** The open list `held`, or none when the file has no such list. */
const listOf = <A>(held: ReadonlyArray<A> | undefined): ReadonlyArray<A> =>
  Option.getOrElse(Option.fromNullishOr(held), () => []);

/** The text of the `at`th line of `lines`, or nothing. */
const lineAt = (held: ReadonlyArray<string>, position: number) =>
  Option.getOrElse(Option.fromNullishOr(held[position]), () => "");

/** Whether `line` starts with `start`. */
const startsWith = (line: string, start: string) => Str.startsWith(start)(line);

/** The change a chapter item holds, for a test that builds the proposal from it. */
const changeOf = (item: BatchItem): ChapterChange =>
  Match.value(item).pipe(
    Match.when({ kind: "chapter" }, ({ change: held }) => held),
    Match.orElse(() =>
      change({ action: "order", chapter: "ch1", plays: ["h-ab", "h-bc"] })
    )
  );

/** What a taken item says it did, for the assertions about final ids. */
const doneBy = (entry: AcceptedItem): ReadonlyArray<string> =>
  Match.value(entry).pipe(
    Match.when({ kind: "structure" }, ({ change: held }) =>
      Match.value(held).pipe(
        Match.when({ action: "group" }, ({ group }) => [`moved into ${group}`]),
        Match.orElse(() => [])
      )
    ),
    Match.when({ kind: "group" }, ({ as }) => [`added as ${as}`]),
    Match.orElse(() => [])
  );

/** Group `a` is moved into the group `storage`. */
const toStorage = (map: MapData): MapData => ({
  ...map,
  groups: [...map.groups, { id: "storage", title: "Data" }],
  structures: Arr.map(map.structures, (held) =>
    held.id === "a" ? { ...held, group: "storage" } : held
  ),
});

const frozenWith = (...items: ReadonlyArray<readonly [string, BatchItem]>) => {
  const proposals: Proposals = {
    ...empty,
    chapters: Arr.flatMap(items, ([, item]) =>
      item.kind === "chapter" ? [{ change: item.change, id: item.id }] : []
    ),
    groups: Arr.flatMap(items, ([, item]) =>
      item.kind === "group" ? [{ change: item.change, id: item.id }] : []
    ),
  };

  return unwrap(freezeOpen({ at, known: { group: ["g1", "g2"] }, proposals }))
    .proposals;
};

/** Proposes group change `change` the way the page does, with no members. */
const proposeEmptyGroup = ({
  change: proposed,
  id,
  proposals,
  world,
}: {
  readonly change: GroupChange;
  readonly id: string;
  readonly proposals: Proposals;
  readonly world: { readonly base: MapData; readonly data: MapData };
}) =>
  proposeGroupWithMembers({
    change: proposed,
    id,
    members: [],
    proposals,
    structures: { data: world.data, layout },
    world,
  });

const verdicted = (proposals: Proposals, id: string, verdict: Verdict) =>
  unwrap(recordVerdict({ id, proposals, verdict }));

const [firstChapter, secondChapter] = data.chapters;

if (firstChapter === undefined || secondChapter === undefined) {
  throw new Error("The fixture map needs two chapters.");
}

describe("the proposed map, for each group action", () => {
  it("adds a new group to the groups, and marks it", () => {
    const shown = proposedMap({
      proposals: withGroups(["p1", addGroup]),
      state,
    });

    assert.deepStrictEqual(
      Arr.map(shown.state.data.groups, ({ id, title }) => [id, title]),
      [
        ["g1", "One"],
        ["g2", "Two"],
        ["data-1", "Data"],
      ]
    );
    assert.isTrue(marked(shown, groupMark).has("data-1"));
  });

  it("renames a group, and marks it", () => {
    const shown = proposedMap({
      proposals: withGroups(["p1", renameGroup]),
      state,
    });

    assert.strictEqual(
      Arr.findFirst(shown.state.data.groups, ({ id }) => id === "g1").pipe(
        Option.map(({ title }) => title),
        Option.getOrElse(() => "")
      ),
      "Front"
    );
    assert.isTrue(marked(shown, groupMark).has("g1"));
  });

  it("makes a structure's group change land in a group the same proposal adds", () => {
    const shown = proposedMap({
      proposals: {
        ...withGroups(["g-1", addGroup]),
        structures: [
          {
            change: { action: "group", group: "data-1", structure: "a" },
            id: "s-1",
          },
          {
            change: { action: "group", group: "data-1", structure: "b" },
            id: "s-2",
          },
        ],
      },
      state,
    });

    assert.deepStrictEqual(
      Arr.map(
        Arr.filter(
          shown.state.data.structures,
          ({ group }) => group === "data-1"
        ),
        ({ id }) => id
      ),
      ["a", "b"]
    );
  });

  it("leaves the layout alone", () => {
    const shown = proposedMap({
      proposals: withGroups(["p1", addGroup], ["p2", renameGroup]),
      state,
    });

    assert.deepStrictEqual(shown.state.layout, layout);
  });
});

describe("proposing a group", () => {
  it("creates a group with members as one write, or nothing", () => {
    const made = unwrap(
      proposeGroupWithMembers({
        change: addGroup,
        id: "g-1",
        members: [
          { id: "s-1", structure: "a" },
          { id: "s-2", structure: "b" },
        ],
        proposals: empty,
        structures: { data, layout },
        world: { base: data, data },
      })
    );

    assert.strictEqual(made.groups?.length, 1);
    assert.deepStrictEqual(idsOf(made.structures), ["s-1", "s-2"]);

    const refused = proposeGroupWithMembers({
      change: addGroup,
      id: "g-1",
      members: [
        { id: "s-1", structure: "a" },
        { id: "s-2", structure: "missing" },
      ],
      proposals: empty,
      structures: { data, layout },
      world: { base: data, data },
    });

    assert.isTrue(Result.isFailure(refused));
  });

  it("refuses a group with the title another group has", () => {
    const refused = proposeEmptyGroup({
      change: { action: "add", group: { id: "again", title: "two" } },
      id: "g-1",
      proposals: empty,
      world: { base: data, data },
    });

    assert.isTrue(Result.isFailure(refused));
    assert.include(Result.merge(refused), "already has a group called");
  });

  it("refuses to rename a group the map lacks", () => {
    const refused = proposeEmptyGroup({
      change: { action: "rename", group: "nope", title: "Nope" },
      id: "g-1",
      proposals: empty,
      world: { base: data, data },
    });

    assert.include(
      Result.merge(refused),
      'No group in the map has the id "nope"'
    );
  });

  it("edits the add when a group that is only proposed is renamed", () => {
    const first = unwrap(
      proposeEmptyGroup({
        change: addGroup,
        id: "g-1",
        proposals: empty,
        world: { base: data, data },
      })
    );

    const grown = {
      ...data,
      groups: [...data.groups, { id: "data-1", title: "Data" }],
    };

    const renamed = unwrap(
      proposeEmptyGroup({
        change: { action: "rename", group: "data-1", title: "Storage" },
        id: "g-2",
        proposals: first,
        world: { base: data, data: grown },
      })
    );

    assert.strictEqual(renamed.groups?.length, 1);
    assert.deepStrictEqual(renamed.groups?.[0]?.change, {
      action: "add",
      group: { id: "data-1", title: "Storage" },
    });
  });

  it("takes the open rename away when the title goes back to what the map has", () => {
    const renamed = unwrap(
      proposeEmptyGroup({
        change: renameGroup,
        id: "g-1",
        proposals: empty,
        world: { base: data, data },
      })
    );

    const undone = unwrap(
      proposeEmptyGroup({
        change: { action: "rename", group: "g1", title: "One" },
        id: "g-2",
        proposals: renamed,
        world: { base: data, data },
      })
    );

    assert.deepStrictEqual(undone.groups, []);
  });
});

describe("the proposed map, for each chapter action", () => {
  it("reveal adds the structure to the chapter and marks it in that chapter only", () => {
    const shown = proposedMap({
      proposals: withChapters([
        "c1",
        change({ action: "reveal", chapter: "ch1", structure: "c" }),
      ]),
      state,
    });

    assert.deepStrictEqual(chapterOf(shown, "ch1").reveals, ["a", "b", "c"]);
    assert.deepStrictEqual(chapterOf(shown, "ch2").reveals, ["c"]);
    assert.isTrue(
      marked(shown, {
        kind: "reveal",
        name: chapterMarkName,
        scope: "ch1",
      }).has("c")
    );
    assert.strictEqual(
      marked(shown, { kind: "reveal", name: chapterMarkName, scope: "ch2" })
        .size,
      0
    );
  });

  it("hide keeps the structure in the chapter, marked, until the agent decides", () => {
    const shown = proposedMap({
      proposals: withChapters([
        "c1",
        change({ action: "hide", chapter: "ch1", structure: "b" }),
      ]),
      state,
    });

    assert.deepStrictEqual(chapterOf(shown, "ch1").reveals, ["a", "b"]);
    assert.isTrue(
      marked(shown, { kind: "hide", name: chapterMarkName, scope: "ch1" }).has(
        "b"
      )
    );
  });

  it("play adds the hop to the chapter's plays", () => {
    const shown = proposedMap({
      proposals: withChapters([
        "c1",
        change({ action: "play", chapter: "ch2", hop: "h-ab" }),
      ]),
      state,
    });

    assert.deepStrictEqual(chapterOf(shown, "ch2").plays, [
      "h-bc",
      "h-ca",
      "h-ab",
    ]);
    assert.isTrue(
      marked(shown, { kind: "play", name: chapterMarkName, scope: "ch2" }).has(
        "h-ab"
      )
    );
  });

  it("unplay keeps the hop, marked, until the agent decides", () => {
    const shown = proposedMap({
      proposals: withChapters([
        "c1",
        change({ action: "unplay", chapter: "ch2", hop: "h-ca" }),
      ]),
      state,
    });

    assert.deepStrictEqual(chapterOf(shown, "ch2").plays, ["h-bc", "h-ca"]);
    assert.isTrue(
      marked(shown, {
        kind: "unplay",
        name: chapterMarkName,
        scope: "ch2",
      }).has("h-ca")
    );
  });

  it("order puts the plays in the new order, in that chapter only", () => {
    const shown = proposedMap({
      proposals: withChapters([
        "c1",
        change({ action: "order", chapter: "ch2", plays: ["h-ca", "h-bc"] }),
      ]),
      state,
    });

    assert.deepStrictEqual(chapterOf(shown, "ch2").plays, ["h-ca", "h-bc"]);
    assert.deepStrictEqual(chapterOf(shown, "ch1").plays, ["h-ab"]);
    assert.isTrue(
      marked(shown, { kind: "order", name: chapterMarkName, scope: "ch2" }).has(
        "ch2"
      )
    );
  });

  it("changes nothing about the diagram: structures, hops, groups and layout", () => {
    const shown = proposedMap({
      proposals: withChapters(
        ["c1", change({ action: "reveal", chapter: "ch1", structure: "c" })],
        ["c2", change({ action: "play", chapter: "ch1", hop: "h-bc" })]
      ),
      state,
    });

    assert.deepStrictEqual(shown.state.data.structures, data.structures);
    assert.deepStrictEqual(shown.state.data.hops, data.hops);
    assert.deepStrictEqual(shown.state.data.groups, data.groups);
    assert.deepStrictEqual(shown.state.layout, layout);
    assert.strictEqual(shown.structures.size, 0);
    assert.strictEqual(shown.hops.size, 0);
  });
});

describe("proposing a chapter change", () => {
  const world = { data, proposed: data };

  it("a hide after a reveal of the same structure takes the reveal away", () => {
    const revealed = unwrap(
      proposeChapter({
        change: change({ action: "reveal", chapter: "ch1", structure: "c" }),
        id: "c1",
        proposals: empty,
        world,
      })
    );

    const undone = unwrap(
      proposeChapter({
        change: change({ action: "hide", chapter: "ch1", structure: "c" }),
        id: "c2",
        proposals: revealed,
        world,
      })
    );

    assert.deepStrictEqual(undone.chapters, []);
  });

  it("a change that leaves the chapter as it is proposes nothing", () => {
    const same = unwrap(
      proposeChapter({
        change: change({ action: "play", chapter: "ch1", hop: "h-ab" }),
        id: "c1",
        proposals: empty,
        world,
      })
    );

    assert.deepStrictEqual(listOf(same.chapters), []);
  });

  it("a second order of the same chapter replaces the first", () => {
    const first = unwrap(
      proposeChapter({
        change: change({
          action: "order",
          chapter: "ch2",
          plays: ["h-ca", "h-bc"],
        }),
        id: "c1",
        proposals: empty,
        world,
      })
    );

    const second = unwrap(
      proposeChapter({
        change: change({
          action: "order",
          chapter: "ch2",
          plays: ["h-bc", "h-ca"],
        }),
        id: "c2",
        proposals: first,
        world,
      })
    );

    assert.deepStrictEqual(second.chapters, []);
  });

  it("refuses a chapter, structure or hop the map lacks", () => {
    const noChapter = proposeChapter({
      change: change({ action: "reveal", chapter: "nope", structure: "a" }),
      id: "c1",
      proposals: empty,
      world,
    });

    const noStructure = proposeChapter({
      change: change({ action: "reveal", chapter: "ch1", structure: "nope" }),
      id: "c1",
      proposals: empty,
      world,
    });

    const noHop = proposeChapter({
      change: change({ action: "play", chapter: "ch1", hop: "nope" }),
      id: "c1",
      proposals: empty,
      world,
    });

    assert.include(
      Result.merge(noChapter),
      'No chapter in the map has the id "nope"'
    );
    assert.include(
      Result.merge(noStructure),
      'No structure in the map has the id "nope"'
    );
    assert.include(Result.merge(noHop), 'No hop in the map has the id "nope"');
  });

  it("lets the engineer propose a hop before the structures it needs", () => {
    const proposed = proposeChapter({
      change: change({ action: "play", chapter: "ch1", hop: "h-bc" }),
      id: "c1",
      proposals: empty,
      world,
    });

    assert.isTrue(Result.isSuccess(proposed));
  });
});

describe("review's breakage for a chapter that plays an unrevealed hop", () => {
  it("names the hop and the structures the chapter hasn't revealed", () => {
    // h-bc ends at c, which the first chapter hasn't revealed.
    const play = chapterItem(
      "c1",
      change({ action: "play", chapter: "ch1", hop: "h-bc" })
    );

    const broken = breakage(play);

    assert.isTrue(Option.isSome(broken));

    const text = Option.getOrThrow(broken);

    assert.include(text, "b to c");
    assert.include(text, "h-bc");
    assert.include(text, "Structure c");
    assert.notInclude(text, "Structure b");
  });

  it("counts structures an earlier chapter revealed", () => {
    // The second chapter plays h-ab, and the first revealed a and b.
    const play = chapterItem(
      "c1",
      change({ action: "play", chapter: "ch2", hop: "h-ab" })
    );

    assert.isTrue(Option.isNone(breakage(play)));
  });

  it("is satisfied by a reveal in the same batch", () => {
    const reveal = chapterItem(
      "c1",
      change({ action: "reveal", chapter: "ch1", structure: "c" })
    );

    const play = chapterItem(
      "c2",
      change({ action: "play", chapter: "ch1", hop: "h-bc" })
    );

    assert.isTrue(Option.isNone(breakage(play, [reveal, play])));
    assert.isTrue(Option.isSome(breakage(play, [play])));
  });

  it("flags a hide that leaves a played hop without its structure", () => {
    const hide = chapterItem(
      "c1",
      change({ action: "hide", chapter: "ch1", structure: "b" })
    );

    const text = Option.getOrThrow(breakage(hide));

    assert.include(text, "a to b");
    assert.include(text, "Structure b");
  });

  it("flags a hide that leaves no chapter revealing the structure", () => {
    const hide = chapterItem(
      "c1",
      change({ action: "hide", chapter: "ch2", structure: "c" })
    );

    const text = Option.getOrThrow(breakage(hide));

    assert.include(text, "no chapter would reveal");
  });

  it("does not flag a problem the map already had", () => {
    const broken: MapData = {
      ...data,
      chapters: [
        { ...firstChapter, plays: ["h-ab", "h-bc"] },
        ...data.chapters.slice(1),
      ],
    };

    const unplay = chapterItem(
      "c1",
      change({ action: "unplay", chapter: "ch1", hop: "h-ab" })
    );

    assert.isTrue(Option.isNone(breakage(unplay, [unplay], broken)));
  });

  it("flags a chapter or a hop that data.mjs no longer has", () => {
    const lostChapter = chapterItem(
      "c1",
      change({ action: "play", chapter: "gone", hop: "h-ab" })
    );

    const lostHop = chapterItem(
      "c1",
      change({ action: "play", chapter: "ch1", hop: "gone" })
    );

    assert.include(Option.getOrThrow(breakage(lostChapter)), "No chapter");
    assert.include(
      Option.getOrThrow(breakage(lostHop)),
      'No hop in data.mjs has the id "gone"'
    );
  });
});

describe("a group or chapter item through freeze, verdict and commit", () => {
  it("a group the agent added under its provisional id is accepted as is", () => {
    const frozen = verdicted(
      frozenWith(["g-1", groupItem("g-1", addGroup)]),
      "g-1",
      { verdict: "accepted" }
    );

    const next: MapData = {
      ...data,
      groups: [...data.groups, { id: "data-1", title: "Data" }],
    };

    const committing = unwrap(
      commitBatch({
        at,
        data: next,
        hops: next.hops,
        layout,
        proposals: frozen,
        revision: 1,
        saved: layout,
      })
    );

    assert.deepStrictEqual(
      Arr.map(committing.accepted, ({ id, kind }) => [kind, id]),
      [["group", "g-1"]]
    );
  });

  it("refuses to commit a group data.mjs doesn't have", () => {
    const frozen = verdicted(
      frozenWith(["g-1", groupItem("g-1", addGroup)]),
      "g-1",
      { verdict: "accepted" }
    );

    const committed = commitBatch({
      at,
      data,
      hops: data.hops,
      layout,
      proposals: frozen,
      revision: 1,
      saved: layout,
    });

    assert.isTrue(Result.isFailure(committed));
    assert.include(Result.merge(committed), "data.mjs has no group");
  });

  it("follows changed --as: a structure moved into the group takes the final id", () => {
    const proposals: Proposals = {
      ...empty,
      groups: [{ change: addGroup, id: "g-1" }],
      structures: [
        {
          change: { action: "group", group: "data-1", structure: "a" },
          id: "s-1",
        },
      ],
    };

    const frozen = unwrap(
      freezeOpen({ at, known: { group: ["g1", "g2"] }, proposals })
    ).proposals;

    const decided = verdicted(
      verdicted(frozen, "g-1", {
        as: "storage",
        reason: "Called it storage.",
        verdict: "changed",
      }),
      "s-1",
      { verdict: "accepted" }
    );

    const next = toStorage(data);

    const committing = unwrap(
      commitBatch({
        at,
        data: next,
        hops: next.hops,
        layout,
        proposals: decided,
        revision: 1,
        saved: layout,
      })
    );

    // The batch records each item as the agent took it: the structure moves
    // into the group under its final id, and the group says it was added as
    // that id.
    assert.deepStrictEqual(Arr.flatMap(committing.accepted, doneBy), [
      "moved into storage",
      "added as storage",
    ]);
  });

  it("refuses --as on a group when the accepted map has that group", () => {
    const frozen = frozenWith(["g-1", groupItem("g-1", addGroup)]);

    const refused = recordVerdict({
      id: "g-1",
      proposals: frozen,
      verdict: { as: "g2", reason: "No.", verdict: "changed" },
    });

    assert.isTrue(Result.isFailure(refused));
    assert.include(Result.merge(refused), "already has");
  });

  it("refuses --as on a chapter item", () => {
    const frozen = frozenWith([
      "c-1",
      chapterItem(
        "c-1",
        change({ action: "reveal", chapter: "ch1", structure: "c" })
      ),
    ]);

    const refused = recordVerdict({
      id: "c-1",
      proposals: frozen,
      verdict: { as: "x", reason: "No.", verdict: "changed" },
    });

    assert.include(Result.merge(refused), "adds no structure");
  });

  it("a chapter item is accepted once data.mjs holds the change", () => {
    const reveal = change({ action: "reveal", chapter: "ch1", structure: "c" });

    const frozen = verdicted(
      frozenWith(["c-1", chapterItem("c-1", reveal)]),
      "c-1",
      { verdict: "accepted" }
    );

    const refusedFirst = commitBatch({
      at,
      data,
      hops: data.hops,
      layout,
      proposals: frozen,
      revision: 1,
      saved: layout,
    });

    assert.isTrue(Result.isFailure(refusedFirst));

    const next: MapData = {
      ...data,
      chapters: [
        { ...firstChapter, reveals: ["a", "b", "c"] },
        { ...secondChapter, reveals: [] },
      ],
    };

    const committing = unwrap(
      commitBatch({
        at,
        data: next,
        hops: next.hops,
        layout,
        proposals: frozen,
        revision: 1,
        saved: layout,
      })
    );

    assert.deepStrictEqual(
      Arr.map(committing.accepted, ({ kind }) => kind),
      ["chapter"]
    );
  });
});

describe("the prompt and review list diagram and chapter changes apart", () => {
  const play = chapterItem(
    "c-1",
    change({ action: "play", chapter: "ch2", hop: "h-ab" })
  );

  const group = groupItem("g-1", addGroup);

  const reveal = chapterItem(
    "c-2",
    change({ action: "reveal", chapter: "ch1", structure: "c" })
  );

  const note: BatchItem = {
    id: "n",
    kind: "note",
    target: { id: "a", kind: "structure" },
    text: "Hi",
  };

  it("groups items by section, diagram first", () => {
    assert.deepStrictEqual(
      Arr.map(bySection([play, group, reveal]), ({ items, section }) => [
        section,
        Arr.map(items, ({ id }) => id),
      ]),
      [
        ["diagram", ["g-1"]],
        ["chapter", ["c-1", "c-2"]],
      ]
    );
  });

  it("the prompt has a heading for each section, and each item under its own", () => {
    const lines = promptLines(
      {
        ...empty,
        chapters: [{ change: changeOf(play), id: "c-1" }],
        groups: [{ change: addGroup, id: "g-1" }],
      },
      names
    );

    const diagram = lines.indexOf("Diagram changes:");
    const chapters = lines.indexOf("Chapter changes:");

    assert.isAbove(diagram, -1);
    assert.isAbove(chapters, diagram);

    const under = (from: number, to: number) =>
      Arr.filter(lines.slice(from, to), Str.startsWith("- "));

    const diagramLines = under(diagram, chapters);
    const chapterLines = under(chapters, lines.length);

    assert.strictEqual(diagramLines.length, 1);
    assert.isTrue(startsWith(lineAt(diagramLines, 0), "- add group g-1:"));
    assert.strictEqual(chapterLines.length, 1);
    assert.isTrue(startsWith(lineAt(chapterLines, 0), "- play c-1:"));
  });

  it("a batch with only diagram changes has no chapter heading", () => {
    const lines = promptLines(
      {
        ...empty,
        groups: [{ change: addGroup, id: "g-1" }],
      },
      names
    );

    assert.include(lines, "Diagram changes:");
    assert.notInclude(lines, "Chapter changes:");
  });

  it("names the chapter by its title and the hop by its label", () => {
    const line = promptLine(
      { ...empty, chapters: [{ change: changeOf(play), id: "c-1" }] },
      names
    );

    assert.include(line, '"a to b"');
    assert.include(line, '"Second"');
    assert.include(line, "ch2");
  });

  it("only chapter changes are in the chapter section", () => {
    assert.strictEqual(specOf(play).section, "chapter");
    assert.strictEqual(specOf(reveal).section, "chapter");
    assert.strictEqual(specOf(group).section, "diagram");
    assert.strictEqual(specOf(note).section, "diagram");
  });
});

const decodeWrite = Schema.decodeUnknownResult(GroupWrite);

/** Whether a group write that renames g1 to `title` is refused. */
const titleRefused = (title: string) =>
  Result.isFailure(
    decodeWrite({
      baseFileRevision: 0,
      change: { action: "rename", group: "g1", title },
      id: "g",
    })
  );

/** Whether a group write with `members` is refused. */
const writeRefused = (members: ReadonlyArray<unknown>) =>
  Result.isFailure(
    decodeWrite({
      baseFileRevision: 0,
      change: addGroup,
      id: "g-1",
      members,
    })
  );

/** `count` members, each a different structure. */
const membersOf = (count: number) =>
  Arr.map(Arr.range(1, count), (n) => ({ id: `s-${n}`, structure: `a${n}` }));

describe("a group write", () => {
  it("takes a title of one trimmed line of up to 80 characters", () => {
    assert.isFalse(titleRefused("Data layer"));
    assert.isFalse(titleRefused(Str.repeat(80)("x")));
    assert.isTrue(titleRefused(Str.repeat(81)("x")));
    assert.isTrue(titleRefused(" Data"));
  });

  it("refuses a rename or a new group whose title carries a line break", () => {
    const rename = { action: "rename", group: "g1", title: "Front\u0085" };

    const created = {
      action: "add",
      group: { id: "x-1", title: "\u0085Front" },
    };

    for (const proposed of [rename, created]) {
      assert.isTrue(
        Result.isFailure(
          decodeWrite({ baseFileRevision: 0, change: proposed, id: "g" })
        )
      );
    }

    for (const bad of ["\u0085Data", "Data\u2028", "\nData"]) {
      assert.isTrue(titleRefused(bad), JSON.stringify(bad));
    }
  });

  it("takes a structure id with no line break", () => {
    assert.isFalse(writeRefused(membersOf(1)));
    assert.isTrue(writeRefused([{ id: "s-1", structure: "a\nb" }]));
  });

  it("caps the members at 200", () => {
    assert.isFalse(writeRefused(membersOf(200)));
    assert.isTrue(writeRefused(membersOf(201)));
  });
});
