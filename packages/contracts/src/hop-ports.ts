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
export interface HopPort {
  /** Where it is drawn, on screen. */
  readonly at: ScreenPoint;
  readonly ground: GridPoint;
  /** Unique on the page: an edge handle's `id`, or `<owner>:centre`. */
  readonly key: string;
  readonly owner: string;
  readonly side: Side | "centre";
}

/**
 * Every port in `scene` of the structures in `revealed`: each structure's
 * edge handles, or one port at its middle when no side has room for one, so
 * every structure can take a hop. A centre key can't clash with a handle's,
 * which always ends in a side.
 */
export const hopPortsOf = ({
  revealed,
  scene,
}: {
  readonly revealed: ReadonlySet<string>;
  readonly scene: Scene;
}): ReadonlyArray<HopPort> =>
  Arr.flatMap(
    scene.structures,
    ({ placement, structure }): ReadonlyArray<HopPort> => {
      if (!revealed.has(structure.id)) {
        return [];
      }

      const spots = edgeSpotsOf({ scene, structure: structure.id });

      if (Arr.isReadonlyArrayNonEmpty(spots)) {
        return Arr.map(spots, ({ at, ground, id, owner, side }): HopPort => ({
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
 * The port a hop dropped at ground `point` lands on: the structure under it,
 * other than `except`, and that structure's port nearest the point on
 * screen, however far. `null` over empty ground.
 */
export const hopPortAt = ({
  except,
  placements,
  point,
  ports,
  revealed,
  view,
}: {
  readonly except: string;
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly point: GridPoint;
  readonly ports: ReadonlyArray<HopPort>;
  readonly revealed: ReadonlySet<string>;
  readonly view: View;
}): HopPort | null => {
  const owner = structureAt({ except, placements, point, revealed });

  if (owner === null) {
    return null;
  }

  const { sx, sy } = groundProjections[view].toScreen(point);

  return Option.getOrNull(
    Arr.reduce(
      Arr.filter(ports, (port) => port.owner === owner),
      Option.none<HopPort>(),
      (best, port) =>
        Option.isSome(best) &&
        Math.hypot(best.value.at.sx - sx, best.value.at.sy - sy) <=
          Math.hypot(port.at.sx - sx, port.at.sy - sy)
          ? best
          : Option.some(port)
    )
  );
};
