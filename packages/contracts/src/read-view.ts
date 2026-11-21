import { Array as Arr, Order } from "effect";

import { boundsOfPoints } from "./geometry.ts";
import type { ScreenRect } from "./iso.ts";
import type { View } from "./plan.ts";
import type { Scene } from "./scene.ts";

/** A box on screen, in client pixels. */
export interface ViewBox {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** What the engineer sees, for an agent to read without reading pixels. */
export interface ViewRead {
  readonly chapter: { readonly id: string; readonly title: string };
  readonly hops: ReadonlyArray<{
    readonly box: ViewBox;
    readonly from: string;
    readonly id: string;
    readonly label: string;
    readonly to: string;
  }>;
  /** The structure whose inside view covers the map, or `null`. */
  readonly inside: string | null;
  /** Ids, sorted. */
  readonly multiSelection: ReadonlyArray<string>;
  readonly pinned: string | null;
  /** What the map draws at full strength, or `null` when nothing fades. */
  readonly spotlight: {
    readonly hops: ReadonlyArray<string>;
    readonly structures: ReadonlyArray<string>;
  } | null;
  readonly structures: ReadonlyArray<{
    readonly box: ViewBox;
    readonly id: string;
    readonly name: string;
  }>;
  readonly view: View;
}

export interface ViewReadSource {
  readonly chapter: { readonly id: string; readonly title: string };
  readonly inside: string | null;
  readonly multiSelection: ReadonlySet<string>;
  readonly pinned: string | null;
  readonly scene: Scene;
  readonly spotlight: {
    readonly hops: ReadonlySet<string>;
    readonly structures: ReadonlySet<string>;
  } | null;
  /** A scene point on screen, such as ui-sdk's `viewport.toScreen`. */
  readonly toScreen: (point: { x: number; y: number }) => {
    x: number;
    y: number;
  };
  readonly view: View;
}

const sorted = (ids: Iterable<string>) =>
  Arr.sort(Arr.fromIterable(ids), Order.String);

/**
 * Reads the scene as the engineer sees it. The camera is a scale and a
 * translation, so a rect's two corners on screen are its box on screen.
 */
export const viewReadOf = ({
  chapter,
  inside,
  multiSelection,
  pinned,
  scene,
  spotlight,
  toScreen,
  view,
}: ViewReadSource): ViewRead => {
  const boxOf = ({ bottom, left, right, top }: ScreenRect): ViewBox => {
    const from = toScreen({ x: left, y: top });
    const to = toScreen({ x: right, y: bottom });

    return { bottom: to.y, left: from.x, right: to.x, top: from.y };
  };

  return {
    chapter: { id: chapter.id, title: chapter.title },
    hops: Arr.map(scene.hops, ({ hop, points }) => ({
      box: boxOf(boundsOfPoints(points)),
      from: hop.from,
      id: hop.id,
      label: hop.label,
      to: hop.to,
    })),
    inside,
    multiSelection: sorted(multiSelection),
    pinned,
    spotlight:
      spotlight === null
        ? null
        : {
            hops: sorted(spotlight.hops),
            structures: sorted(spotlight.structures),
          },
    structures: Arr.map(scene.structures, ({ bounds, structure }) => ({
      box: boxOf(bounds),
      id: structure.id,
      name: structure.name,
    })),
    view,
  };
};
