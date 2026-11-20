import { Array as Arr, Option } from "effect";

import {
  GroupTitle,
  groupOf,
  maxGroupTitleLength,
  titleOf,
} from "./group-change.ts";
import { groupFit } from "./group-fit.ts";
import type { MapData } from "./map-data.ts";
import type { BatchItem, LayoutChange, Verdict } from "./proposals.ts";
import { provisionalOf } from "./provisional-ids.ts";
import { plain, touchesNothing } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate, quoteText } from "./review-quote.ts";
import { refusalOf } from "./text-schemas.ts";

// The kind for a proposed change to the groups: a new group, or a new title
// for one. It is a diagram proposal. The structures that move into a new
// group are structure items of their own that change their group. It is one
// entry of the kind table; `review-kinds.ts` lists it.

type GroupItem = Extract<BatchItem, { kind: "group" }>;

/** The name of the mark for groups a proposal touches, in `Touches.marks`. */
export const groupMark = "group";

/** Said once, in the prompt and in `review`, when a batch holds a group item. */
const groupNotice =
  "A group item changes data.mjs, which only you edit. A new group comes with a provisional id: add it to the groups in data.mjs under that id, or under another and give the verdict changed with --as <id>. The structures the engineer put in it are separate items that change their group to it.";

/** What the group kind adds under a provisional id, and how it says so. */
const provisional = provisionalOf<GroupItem>({
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.group.id) : Option.none(),
  entity: "group",
  noun: "group",
});

/**
 * The id a taken group item ends up with: the provisional id, or the one the
 * agent gave with `--as`.
 */
const finalIdOf = (item: GroupItem, verdict: Verdict): string =>
  Option.getOrElse(provisional.finalIdOf(item, verdict), () =>
    groupOf(item.change)
  );

const titleIn = (data: Pick<MapData, "groups">, id: string) =>
  Option.map(
    Arr.findFirst(data.groups, (group) => group.id === id),
    ({ title }) => title
  );

export const groupKind: KindSpec<GroupItem> = {
  ...plain<GroupItem>(),
  listKey: "groups",
  textLimit: maxGroupTitleLength,
  // The title has its own rules, so an edit goes through the panel's rename.
  dangling: ({ change }, known) =>
    change.action === "add" || known.groups.has(change.group)
      ? Option.none()
      : Option.some(`no group in data.mjs has the id "${change.group}"`),
  describe: ({ change }, called) =>
    Option.some(
      change.action === "add"
        ? `Add the group ${change.group.title}`
        : `Rename the group ${called.acceptedGroup(change.group)} to ${change.title}`
    ),
  text: ({ change }) => Option.some(titleOf(change)),
  textRefusal: (_item, text) => refusalOf(GroupTitle, text),
  // The checks `proposeGroup` runs on a fresh proposal.
  accepted: (item, verdict) => {
    const base = { change: item.change, id: item.id, kind: "group" } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.group.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  add: (proposals, { change, id }) => ({
    ...proposals,
    groups: [...(proposals.groups ?? []), { change, id }],
  }),
  applies: (): ReadonlyArray<LayoutChange> => [],
  appliesToData: ({ change }, map) => ({
    ...map,
    data:
      change.action === "add"
        ? Arr.some(map.data.groups, ({ id }) => id === change.group.id)
          ? map.data
          : {
              ...map.data,
              groups: [
                ...map.data.groups,
                { id: change.group.id, title: change.group.title },
              ],
            }
        : {
            ...map.data,
            groups: Arr.map(map.data.groups, (group) =>
              group.id === change.group
                ? { ...group, title: change.title }
                : group
            ),
          },
  }),
  breakage: ({ change }, { data }) =>
    data === undefined || change.action === "add"
      ? Option.none()
      : Option.isSome(titleIn(data, change.group))
        ? Option.none()
        : Option.some(
            `No group in data.mjs has the id "${change.group}", so this rename has nothing to act on.`
          ),
  clear: (proposals) => ({ ...proposals, groups: [] }),
  commitRefusal: (item, verdict, { data }) => {
    const { change } = item;

    if (change.action === "add") {
      const id = finalIdOf(item, verdict);

      return Arr.some(data.groups, (group) => group.id === id)
        ? Option.none()
        : Option.some(
            `data.mjs has no group with the id "${id}", so item ${item.id} can't be taken. Add the group to data.mjs${id === change.group.id ? `, or give the id you used with: verdict ... changed --as <id>` : ""}. Or reject the item.`
          );
    }

    return verdict.verdict === "accepted" &&
      !Option.exists(titleIn(data, change.group), (now) => now === change.title)
      ? Option.some(
          `data.mjs does not call the group "${change.group}" ${quoteText(change.title)}, so item ${item.id} can't be taken as accepted. Rename it in data.mjs, give the verdict changed, or reject the item.`
        )
      : Option.none();
  },
  facts: ({ change }, _layout, data) => ({
    after: {
      group: { id: groupOf(change), title: titleOf(change) },
    },
    before:
      change.action === "add" || data === undefined
        ? null
        : Option.match(titleIn(data, change.group), {
            onNone: () => null,
            onSome: (title) => ({ group: { id: change.group, title } }),
          }),
  }),
  fits: ({ change }, data) => groupFit(change, data),
  name: ({ change }) =>
    change.action === "add" ? "add group" : "rename group",
  notice: groupNotice,
  open: (proposals) =>
    Arr.map(proposals.groups ?? [], (proposal): GroupItem => ({
      change: proposal.change,
      id: proposal.id,
      kind: "group",
    })),
  rejected: (item, reason) => ({
    change: item.change,
    id: item.id,
    kind: "group",
    reason,
  }),
  renames: provisional.renames,
  reopened: (item, newId, text) => ({
    ...item,
    change:
      text === undefined
        ? item.change
        : item.change.action === "add"
          ? { ...item.change, group: { ...item.change.group, title: text } }
          : { ...item.change, title: text },
    id: newId,
  }),
  summary: ({ change, id }, called) =>
    change.action === "add"
      ? `add group ${id}: ${quoteText(change.group.title)}, provisional id ${change.group.id}`
      : `rename group ${id}: ${quoteText(called.acceptedGroup(change.group))} to ${quoteText(change.title)}`,
  targets: ({ change }): ReadonlyArray<Pointer> => [
    { id: groupOf(change), kind: "group" },
  ],
  touches: ({ change }) => ({
    ...touchesNothing,
    marks: [{ ids: [groupOf(change)], name: groupMark }],
  }),
  verdictRefusal: provisional.verdictRefusal,
};
