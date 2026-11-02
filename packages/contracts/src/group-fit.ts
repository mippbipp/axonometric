import { Array as Arr, Option, String as Str } from "effect";
import { dual } from "effect/Function";

import { groupOf, titleOf } from "./group-change.ts";
import type { GroupChange } from "./group-change.ts";
import type { MapData } from "./map-data.ts";

const sameTitle = (a: string, b: string) =>
  Str.toLowerCase(Str.trim(a)) === Str.toLowerCase(Str.trim(b));

/** Why no other group may be called `title`, or nothing. */
export const titleClash: {
  (
    group: string,
    title: string
  ): (groups: MapData["groups"]) => Option.Option<string>;
  (
    groups: MapData["groups"],
    group: string,
    title: string
  ): Option.Option<string>;
} = dual(
  3,
  (
    groups: MapData["groups"],
    group: string,
    title: string
  ): Option.Option<string> =>
    Option.map(
      Arr.findFirst(
        groups,
        (other) => other.id !== group && sameTitle(other.title, title)
      ),
      () =>
        `The map already has a group called "${title}". Pick another title, so the zones stay tellable apart.`
    )
);

/**
 * Why `change` doesn't fit `data`, the map as proposed without it: a title
 * another group has, a new group's id the map already uses, or a rename of a
 * group the map lacks. `proposeGroup` runs this on a fresh proposal and
 * `reopenItem` on an item edited again.
 */
export const groupFit: {
  (
    data: Pick<MapData, "groups">
  ): (change: GroupChange) => Option.Option<string>;
  (change: GroupChange, data: Pick<MapData, "groups">): Option.Option<string>;
} = dual(
  2,
  (
    change: GroupChange,
    data: Pick<MapData, "groups">
  ): Option.Option<string> => {
    const target = groupOf(change);
    const known = Arr.some(data.groups, (group) => group.id === target);

    if (change.action === "add" && known) {
      return Option.some(
        `The map already has a group with the id "${target}".`
      );
    }

    if (change.action === "rename" && !known) {
      return Option.some(
        `No group in the map has the id "${target}", so there is nothing to rename.`
      );
    }

    return titleClash(data.groups, target, titleOf(change));
  }
);
