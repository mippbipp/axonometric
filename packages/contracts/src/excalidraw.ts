import { Array as Arr, Option, String as Str } from "effect";

import { boundsOfPoints } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Layout } from "./layout.ts";
import type { MapData, Status } from "./map-data.ts";
import { sceneOf } from "./scene.ts";

// An Excalidraw file of the whole map, drawn from Plan view's scene: a
// rectangle per structure with its name bound inside, an arrow per hop bound
// to both rectangles with its label bound to it, and a frame per group. The
// format is Excalidraw's plain JSON, version 2. Ids come from the map's ids,
// and every other value from the map, so the same map always writes the same
// file.

/** Where an arrow's end is bound, in Excalidraw's binding format. */
export interface ExcalidrawBinding {
  readonly elementId: string;
  /** For Excalidraw before fixed-point bindings: aim at the middle. */
  readonly focus: number;
  readonly gap: number;
  readonly mode: "orbit";
  /** Where the end touches the element, as a share of its width and height. */
  readonly fixedPoint: readonly [number, number];
}

/** What another element bound to this one is. */
export interface ExcalidrawBound {
  readonly type: "arrow" | "text";
  readonly id: string;
}

interface ElementBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: 0;
  readonly strokeColor: string;
  readonly backgroundColor: string;
  readonly fillStyle: "solid";
  readonly strokeWidth: number;
  readonly strokeStyle: "solid" | "dashed";
  readonly roughness: 0;
  readonly opacity: number;
  readonly groupIds: readonly string[];
  readonly frameId: string | null;
  readonly index: null;
  readonly roundness: { readonly type: 3 } | null;
  readonly seed: number;
  readonly version: 1;
  readonly versionNonce: 0;
  readonly isDeleted: false;
  readonly boundElements: readonly ExcalidrawBound[];
  readonly updated: 1;
  readonly link: null;
  readonly locked: false;
}

export interface ExcalidrawRectangle extends ElementBase {
  readonly type: "rectangle";
}

export interface ExcalidrawText extends ElementBase {
  readonly type: "text";
  readonly text: string;
  readonly originalText: string;
  readonly fontSize: number;
  readonly fontFamily: number;
  readonly textAlign: "center";
  readonly verticalAlign: "middle";
  readonly containerId: string;
  readonly autoResize: true;
  readonly lineHeight: number;
}

export interface ExcalidrawArrow extends ElementBase {
  readonly type: "arrow";
  /** Relative to `x` and `y`; the first is always [0, 0]. */
  readonly points: readonly (readonly [number, number])[];
  readonly startBinding: ExcalidrawBinding | null;
  readonly endBinding: ExcalidrawBinding | null;
  readonly startArrowhead: null;
  readonly endArrowhead: "arrow";
  readonly elbowed: false;
}

export interface ExcalidrawFrame extends ElementBase {
  readonly type: "frame";
  readonly name: string;
}

export type ExcalidrawElement =
  | ExcalidrawRectangle
  | ExcalidrawText
  | ExcalidrawArrow
  | ExcalidrawFrame;

/** A `.excalidraw` file. */
export interface ExcalidrawFile {
  readonly type: "excalidraw";
  readonly version: 2;
  readonly source: string;
  readonly elements: readonly ExcalidrawElement[];
  readonly appState: {
    readonly viewBackgroundColor: string;
    readonly gridSize: null;
  };
  readonly files: Readonly<Record<string, never>>;
}

/** What `excalidrawOf` draws: a map and its layout. */
export interface ExcalidrawSource {
  readonly data: MapData;
  readonly layout: Layout;
  /** The canvas colour. Defaults to the map's paper colour. */
  readonly background?: string | undefined;
}

/** The light theme's colours, from the editor's palette. */
const ink = "#17170f";

const face = "#efe9cc";

const paper = "#e6dfbe";

/** Cascadia, Excalidraw's monospace font, closest to the map's. */
const monospace = 3;

const nameSize = 16;

const labelSize = 14;

const lineHeight = 1.25;

/** An estimate of how wide monospace text is, as a share of its size. */
const charWidth = 0.6;

/** The element ids, one namespace per kind, so map ids can't clash. */
export const excalidrawIds = {
  structure: (id: string) => `structure:${id}`,
  name: (id: string) => `structure-name:${id}`,
  hop: (id: string) => `hop:${id}`,
  label: (id: string) => `hop-label:${id}`,
  group: (id: string) => `group:${id}`,
};

/** A stable 31-bit seed from an id: FNV-1a. */
const seedOf = (id: string) => {
  let hash = 2_166_136_261;

  for (const char of id) {
    hash ^= Option.getOrElse(Str.codePointAt(char, 0), () => 0);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 1) + 1;
};

const strokeStyles: Readonly<Record<Status, "solid" | "dashed">> = {
  live: "solid",
  planned: "dashed",
  off: "solid",
};

const opacities: Readonly<Record<Status, number>> = {
  live: 100,
  planned: 100,
  off: 50,
};

const base = (
  id: string,
  rect: ScreenRect,
  frameId: string | null
): ElementBase => ({
  id,
  x: rect.left,
  y: rect.top,
  width: rect.right - rect.left,
  height: rect.bottom - rect.top,
  angle: 0,
  strokeColor: ink,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId,
  index: null,
  roundness: null,
  seed: seedOf(id),
  version: 1,
  versionNonce: 0,
  isDeleted: false,
  boundElements: [],
  updated: 1,
  link: null,
  locked: false,
});

/** Text of `size` centred on `centre`, bound to `containerId`. */
const boundText = ({
  id,
  text,
  size,
  centre,
  containerId,
  frameId,
}: {
  readonly id: string;
  readonly text: string;
  readonly size: number;
  readonly centre: ScreenPoint;
  readonly containerId: string;
  readonly frameId: string | null;
}): ExcalidrawText => {
  const width = text.length * size * charWidth;
  const height = size * lineHeight;

  return {
    ...base(
      id,
      {
        left: centre.sx - width / 2,
        top: centre.sy - height / 2,
        right: centre.sx + width / 2,
        bottom: centre.sy + height / 2,
      },
      frameId
    ),
    type: "text",
    text,
    originalText: text,
    fontSize: size,
    fontFamily: monospace,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
    autoResize: true,
    lineHeight,
  };
};

const clampShare = (value: number) => Math.min(1, Math.max(0, value));

const bindingTo = (
  elementId: string,
  rect: ScreenRect,
  at: ScreenPoint
): ExcalidrawBinding => ({
  elementId,
  focus: 0,
  gap: 1,
  mode: "orbit",
  fixedPoint: [
    clampShare((at.sx - rect.left) / Math.max(rect.right - rect.left, 1)),
    clampShare((at.sy - rect.top) / Math.max(rect.bottom - rect.top, 1)),
  ],
});

const middleOf = (rect: ScreenRect): ScreenPoint => ({
  sx: (rect.left + rect.right) / 2,
  sy: (rect.top + rect.bottom) / 2,
});

/** The point halfway along a route, by length. */
const halfway = (points: readonly ScreenPoint[]): ScreenPoint => {
  const legs = Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    return end === undefined
      ? []
      : [
          {
            start,
            end,
            length: Math.hypot(end.sx - start.sx, end.sy - start.sy),
          },
        ];
  });

  let left = Arr.reduce(legs, 0, (sum, leg) => sum + leg.length) / 2;

  for (const leg of legs) {
    if (left <= leg.length && leg.length > 0) {
      const share = left / leg.length;

      return {
        sx: leg.start.sx + (leg.end.sx - leg.start.sx) * share,
        sy: leg.start.sy + (leg.end.sy - leg.start.sy) * share,
      };
    }

    left -= leg.length;
  }

  return points[0] ?? { sx: 0, sy: 0 };
};

/**
 * The whole map as an Excalidraw file, at Plan view's positions: every
 * structure with a placement as a rectangle with its name inside, every hop
 * between them as an arrow bound to both ends with its label on it, and
 * every group with placed structures as a frame around them. A rectangle,
 * its name and every arrow between two members of the same group sit in that
 * group's frame.
 */
export const excalidrawOf = ({
  data,
  layout,
  background = paper,
}: ExcalidrawSource): ExcalidrawFile => {
  const scene = sceneOf({
    data,
    layout,
    revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
    view: "plan",
  });

  const frameOf = new Map(
    Arr.flatMap(scene.zones, ({ zone }) =>
      Arr.map(
        zone.members,
        (member) => [member, excalidrawIds.group(zone.group.id)] as const
      )
    )
  );

  const rectOf = new Map(
    Arr.map(scene.structures, ({ structure, outline }) => [
      structure.id,
      boundsOfPoints(outline),
    ])
  );

  const hopFrame = (from: string, to: string) => {
    const frame = frameOf.get(from);

    return frame !== undefined && frame === frameOf.get(to) ? frame : null;
  };

  const structures = Arr.flatMap(scene.structures, ({ structure }) => {
    const rect = rectOf.get(structure.id);

    if (rect === undefined) {
      return [];
    }

    const id = excalidrawIds.structure(structure.id);
    const frameId = frameOf.get(structure.id) ?? null;

    const arrows = Arr.flatMap(scene.hops, ({ hop }) =>
      hop.from === structure.id || hop.to === structure.id
        ? [{ type: "arrow" as const, id: excalidrawIds.hop(hop.id) }]
        : []
    );

    const rectangle: ExcalidrawRectangle = {
      ...base(id, rect, frameId),
      type: "rectangle",
      backgroundColor: face,
      strokeStyle: strokeStyles[structure.status],
      opacity: opacities[structure.status],
      roundness: { type: 3 },
      boundElements: [
        { type: "text", id: excalidrawIds.name(structure.id) },
        ...arrows,
      ],
    };

    return [
      rectangle,
      boundText({
        id: excalidrawIds.name(structure.id),
        text: structure.name,
        size: nameSize,
        centre: middleOf(rect),
        containerId: id,
        frameId,
      }),
    ];
  });

  const hops = Arr.flatMap(scene.hops, ({ hop, points, label }) => {
    const [first] = points;
    const last = points.at(-1);
    const from = rectOf.get(hop.from);
    const to = rectOf.get(hop.to);

    if (
      first === undefined ||
      last === undefined ||
      from === undefined ||
      to === undefined
    ) {
      return [];
    }

    const id = excalidrawIds.hop(hop.id);
    const frameId = hopFrame(hop.from, hop.to);

    const arrow: ExcalidrawArrow = {
      ...base(id, boundsOfPoints(points), frameId),
      x: first.sx,
      y: first.sy,
      type: "arrow",
      points: Arr.map(
        points,
        ({ sx, sy }) => [sx - first.sx, sy - first.sy] as const
      ),
      startBinding: bindingTo(excalidrawIds.structure(hop.from), from, first),
      endBinding: bindingTo(excalidrawIds.structure(hop.to), to, last),
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
      boundElements: [{ type: "text", id: excalidrawIds.label(hop.id) }],
    };

    return [
      arrow,
      boundText({
        id: excalidrawIds.label(hop.id),
        text: hop.label,
        size: labelSize,
        centre: label === undefined ? halfway(points) : middleOf(label),
        containerId: id,
        frameId,
      }),
    ];
  });

  // Frames come after their members, as Excalidraw orders them.
  const frames = Arr.map(scene.zones, ({ zone, bounds }): ExcalidrawFrame => ({
    ...base(excalidrawIds.group(zone.group.id), bounds, null),
    type: "frame",
    name: zone.group.title,
  }));

  return {
    type: "excalidraw",
    version: 2,
    source: "https://github.com/mippbipp/axonometric",
    elements: [...structures, ...hops, ...frames],
    appState: { viewBackgroundColor: background, gridSize: null },
    files: {},
  };
};
