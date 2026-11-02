import { Array as Arr, Option } from "effect";

import {
  groupOf,
  maxGroupTitleLength,
  titleOf,
  titleRefusal,
} from "./group-change.ts";
import { groupFit } from "./group-fit.ts";
import type { MapData } from "./map-data.ts";
import type { BatchItem, LayoutChange, Verdict } from "./proposals.ts";
import { plain, touchesNothing } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer, Rename } from "./review-kinds.ts";
import { decorate, quoteText } from "./review-quote.ts";

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

/**
 * The id a taken group item ends up with: the provisional id, or the one the
 * agent gave with `--as`.
 */
const finalIdOf = (item: GroupItem, verdict: Verdict): string =>
  item.change.action === "add" &&
  verdict.verdict === "changed" &&
  verdict.as !== undefined
    ? verdict.as
    : groupOf(item.change);

const titleIn = (data: Pick<MapData, "groups">, id: string) =>
  Option.map(
    Arr.findFirst(data.groups, (group) => group.id === id),
    ({ title }) => title
  );

export const groupKind: KindSpec<GroupItem> = {
  ...plain<GroupItem>(),
  textLimit: maxGroupTitleLength,
  listKey: "groups",
  // The title has its own rules, so an edit goes through the panel's rename.
  text: ({ change }) => Option.some(titleOf(change)),
  textRefusal: titleRefusal,
  describe: ({ change }, called) =>
    Option.some(
      change.action === "add"
        ? `Add the group ${change.group.title}`
        : `Rename the group ${called.acceptedGroup(change.group)} to ${change.title}`
    ),
  dangling: ({ change }, known) =>
    change.action === "add" || known.groups.has(change.group)
      ? Option.none()
      : Option.some(`no group in data.mjs has the id "${change.group}"`),
  // The checks `proposeGroup` runs on a fresh proposal.
  fits: ({ change }, data) => groupFit(change, data),
  notice: groupNotice,
  open: (proposals) =>
    Arr.map(proposals.groups ?? [], (proposal): GroupItem => ({
      id: proposal.id,
      kind: "group",
      change: proposal.change,
    })),
  clear: (proposals) => ({ ...proposals, groups: [] }),
  add: (proposals, { id, change }) => ({
    ...proposals,
    groups: [...(proposals.groups ?? []), { id, change }],
  }),
  name: ({ change }) =>
    change.action === "add" ? "add group" : "rename group",
  targets: ({ change }): readonly Pointer[] => [
    { kind: "group", id: groupOf(change) },
  ],
  summary: ({ id, change }, called) =>
    change.action === "add"
      ? `add group ${id}: ${quoteText(change.group.title)}, provisional id ${change.group.id}`
      : `rename group ${id}: ${quoteText(called.acceptedGroup(change.group))} to ${quoteText(change.title)}`,
  facts: ({ change }, _layout, data) => ({
    before:
      change.action === "add" || data === undefined
        ? null
        : Option.match(titleIn(data, change.group), {
            onNone: () => null,
            onSome: (title) => ({ group: { id: change.group, title } }),
          }),
    after: {
      group: { id: groupOf(change), title: titleOf(change) },
    },
  }),
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
  touches: ({ change }) => ({
    ...touchesNothing,
    marks: [{ name: groupMark, ids: [groupOf(change)] }],
  }),
  breakage: ({ change }, { data }) =>
    data === undefined || change.action === "add"
      ? Option.none()
      : Option.isSome(titleIn(data, change.group))
        ? Option.none()
        : Option.some(
            `No group in data.mjs has the id "${change.group}", so this rename has nothing to act on.`
          ),
  verdictRefusal: (item, verdict, { acceptedGroups, taken }) => {
    if (verdict.verdict !== "changed" || verdict.as === undefined) {
      return Option.none();
    }

    if (item.change.action !== "add") {
      return Option.some(
        "--as gives a new group the id you used for it in data.mjs. This item does not add a group."
      );
    }

    if (acceptedGroups?.has(verdict.as) === true) {
      return Option.some(
        `--as ${verdict.as} names a group the accepted map already has. Pick the id of the new group you added to data.mjs.`
      );
    }

    return Option.map(
      Arr.findFirst(
        [...taken.entries()],
        ([other, id]) => other !== item.id && id === verdict.as
      ),
      ([other]) =>
        `--as ${verdict.as} is already the final id of item ${other} in this batch. Give each new group its own id.`
    );
  },
  renames: (item, verdict): readonly Rename[] => {
    if (verdict.verdict === "rejected" || item.change.action !== "add") {
      return [];
    }

    const to = finalIdOf(item, verdict);

    return to === item.change.group.id
      ? []
      : [{ kind: "group", from: item.change.group.id, to }];
  },
  dependents: ({ change }, proposals) =>
    change.action === "add"
      ? Arr.flatMap(proposals.structures ?? [], (proposal) =>
          proposal.change.action === "group" &&
          proposal.change.group === change.group.id
            ? [proposal.id]
            : []
        )
      : [],
  applies: (): readonly LayoutChange[] => [],
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
  accepted: (item, verdict) => {
    const base = { kind: "group", id: item.id, change: item.change } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.group.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  rejected: (item, reason) => ({
    kind: "group",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    change:
      text === undefined
        ? item.change
        : item.change.action === "add"
          ? { ...item.change, group: { ...item.change.group, title: text } }
          : { ...item.change, title: text },
  }),
};
