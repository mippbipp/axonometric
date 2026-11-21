import { Array as Arr, Option } from "effect";

import { edgeSpotsOf } from "./edge-handle-spots.ts";
import type { Side } from "./edge-handle-spots.ts";
import type { ScreenPoint } from "./iso.ts";
import type { GridPoint, Placement } from "./layout.ts";
import { groundProjections } from "./plan.ts";
import type { View } from "./plan.ts";
import type { Scene } from "./scene.ts";

/**
 * A point a hop can be drawn from or to: an edge handle, or the middle of a
 * structure that has no clear spot for one.
 */
export interface HopEnd {
  /** Where it is drawn, on screen. */
  readonly at: ScreenPoint;
  readonly ground: GridPoint;
  /** Unique on the page: an edge handle's `id`, or `<owner>:centre`. */
  readonly key: string;
  readonly owner: string;
  readonly side: Side | "centre";
}

/**
 * Every hop end in `scene` of the structures in `revealed`: each structure's
 * edge handles, or one hop end at its middle when no side has room for one, so
 * every structure can take a hop. A centre key can't clash with a handle's,
 * which always ends in a side.
 */
export const hopEndsOf = ({
  revealed,
  scene,
}: {
  readonly revealed: ReadonlySet<string>;
  readonly scene: Scene;
}): ReadonlyArray<HopEnd> =>
  Arr.flatMap(
    scene.structures,
    ({ placement, structure }): ReadonlyArray<HopEnd> => {
      if (!revealed.has(structure.id)) {
        return [];
      }

      const spots = edgeSpotsOf({ scene, structure: structure.id });

      if (Arr.isReadonlyArrayNonEmpty(spots)) {
        return Arr.map(spots, ({ at, ground, id, owner, side }): HopEnd => ({
          at,
          ground,
          key: id,
          owner,
          side,
        }));
      }

      const ground = {
        x: placement.x + placement.w / 2,
        y: placement.y + placement.d / 2,
      };

      return [
        {
          at: groundProjections[scene.view].toScreen(ground),
          ground,
          key: `${structure.id}:centre`,
          owner: structure.id,
          side: "centre",
        },
      ];
    }
  );

/** The structure whose footprint holds `point`, other than `except`. */
export const structureAt = ({
  except,
  placements,
  point,
  revealed,
}: {
  readonly except: string;
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly point: GridPoint;
  readonly revealed: ReadonlySet<string>;
}): string | null =>
  Option.getOrNull(
    Arr.findFirst(
      Arr.filter([...revealed], (id) => id !== except),
      (id) => {
        const at = placements[id];

        return (
          at !== undefined &&
          point.x >= at.x &&
          point.x <= at.x + at.w &&
          point.y >= at.y &&
          point.y <= at.y + at.d
        );
      }
    )
  );

/**
 * The hop end a hop dropped at ground `point` lands on: the structure under it,
 * other than `except`, and that structure's hop end nearest the point on
 * screen, however far. `null` over empty ground.
 */
export const hopEndAt = ({
  ends,
  except,
  placements,
  point,
  revealed,
  view,
}: {
  readonly ends: ReadonlyArray<HopEnd>;
  readonly except: string;
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly point: GridPoint;
  readonly revealed: ReadonlySet<string>;
  readonly view: View;
}): HopEnd | null => {
  const owner = structureAt({ except, placements, point, revealed });

  if (owner === null) {
    return null;
  }

  const { sx, sy } = groundProjections[view].toScreen(point);

  return Option.getOrNull(
    Arr.reduce(
      Arr.filter(ends, (end) => end.owner === owner),
      Option.none<HopEnd>(),
      (best, end) =>
        Option.isSome(best) &&
        Math.hypot(best.value.at.sx - sx, best.value.at.sy - sy) <=
          Math.hypot(end.at.sx - sx, end.at.sy - sy)
          ? best
          : Option.some(end)
    )
  );
};
