import { Array as Arr } from "effect";

import type { Layout, Placement } from "./layout.ts";
import type { Group, MapData } from "./map-data.ts";

/**
 * How far a group's zone reaches past its structures' footprints, on every
 * side.
 */
export const zonePadding = 1;

/**
 * A group's zone: the ground its structures cover, plus `zonePadding` on
 * every side. It's worked out from the layout each time and never stored.
 */
export interface Zone {
  /** The zone's ground rectangle, in grid units, padding included. */
  readonly box: Placement;
  readonly group: Group;
  /** The ids of the structures it fits, in data.mjs order. */
  readonly members: ReadonlyArray<string>;
}

/** What `zonesOf` fits zones to. */
export interface ZoneSource {
  readonly data: Pick<MapData, "groups" | "structures">;
  readonly layout: Layout;
  /**
   * The structures to fit, such as those revealed so far in the
   * walkthrough. Defaults to every structure.
   */
  readonly revealed?: ReadonlySet<string> | undefined;
}

const boundsOf = (boxes: Arr.NonEmptyReadonlyArray<Placement>): Placement => {
  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));
  const right = Math.max(...Arr.map(boxes, (box) => box.x + box.w));
  const bottom = Math.max(...Arr.map(boxes, (box) => box.y + box.d));

  return { d: bottom - top, w: right - left, x: left, y: top };
};

/**
 * Every group's zone, in `groups` order. A zone fits the group's structures
 * that have a placement and are in `revealed`. A group with none of those
 * gets no zone.
 */
export const zonesOf = ({
  data,
  layout,
  revealed,
}: ZoneSource): ReadonlyArray<Zone> =>
  Arr.flatMap(data.groups, (group) => {
    const members = Arr.flatMap(data.structures, (structure) => {
      const placement = layout.structures[structure.id];

      return structure.group !== group.id ||
        placement === undefined ||
        (revealed !== undefined && !revealed.has(structure.id))
        ? []
        : [{ id: structure.id, placement }];
    });

    if (!Arr.isReadonlyArrayNonEmpty(members)) {
      return [];
    }

    const bounds = boundsOf(Arr.map(members, ({ placement }) => placement));

    return [
      {
        box: {
          d: bounds.d + 2 * zonePadding,
          w: bounds.w + 2 * zonePadding,
          x: bounds.x - zonePadding,
          y: bounds.y - zonePadding,
        },
        group,
        members: Arr.map(members, ({ id }) => id),
      },
    ];
  });

/**
 * The ids of every structure in group `group` that the layout places, in
 * data.mjs order. A zone fits only the structures revealed so far, but
 * moving the group moves all of them.
 */
export const groupMembers = ({
  data,
  group,
  layout,
}: {
  readonly data: Pick<MapData, "structures">;
  readonly group: string;
  readonly layout: Layout;
}): ReadonlyArray<string> =>
  Arr.flatMap(data.structures, (structure) =>
    structure.group === group && layout.structures[structure.id] !== undefined
      ? [structure.id]
      : []
  );
