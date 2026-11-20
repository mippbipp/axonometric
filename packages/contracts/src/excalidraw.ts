import { Array as Arr, Option, String as Str } from "effect";

import { boundsOfPoints, lerp, segmentLength, segmentsOf } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Layout } from "./layout.ts";
import type { MapData, Status } from "./map-data.ts";
import { palette } from "./palette.ts";
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
  /** Where the end touches the element, as a share of its width and height. */
  readonly fixedPoint: readonly [number, number];
  /** For Excalidraw before fixed-point bindings: aim at the middle. */
  readonly focus: number;
  readonly gap: number;
  readonly mode: "orbit";
}

/** What another element bound to this one is. */
export interface ExcalidrawBound {
  readonly id: string;
  readonly type: "arrow" | "text";
}

interface ElementBase {
  readonly angle: 0;
  readonly backgroundColor: string;
  readonly boundElements: ReadonlyArray<ExcalidrawBound>;
  readonly created: 1;
  readonly fillStyle: "solid";
  readonly frameId: string | null;
  readonly groupIds: ReadonlyArray<string>;
  readonly height: number;
  readonly id: string;
  readonly index: null;
  readonly isDeleted: false;
  readonly link: null;
  readonly locked: false;
  readonly opacity: number;
  readonly roughness: 0;
  readonly roundness: { readonly type: typeof proportionalRadius } | null;
  readonly seed: number;
  readonly strokeColor: string;
  readonly strokeStyle: "solid" | "dashed";
  readonly strokeWidth: number;
  readonly updated: 1;
  readonly version: 1;
  readonly versionNonce: 0;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface ExcalidrawRectangle extends ElementBase {
  readonly type: "rectangle";
}

export interface ExcalidrawText extends ElementBase {
  readonly autoResize: true;
  /** The size before any scaling; Excalidraw keeps it only for sticky notes. */
  readonly baseFontSize: null;
  readonly containerId: string;
  readonly fontFamily: number;
  readonly fontSize: number;
  readonly labelPosition: null;
  readonly lineHeight: number;
  readonly originalText: string;
  readonly text: string;
  readonly textAlign: "center";
  readonly type: "text";
  readonly verticalAlign: "middle";
}

export interface ExcalidrawArrow extends ElementBase {
  readonly elbowed: false;
  readonly endArrowhead: "arrow";
  readonly endBinding: ExcalidrawBinding | null;
  /** Relative to `x` and `y`; the first is always [0, 0]. */
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly startArrowhead: null;
  readonly startBinding: ExcalidrawBinding | null;
  readonly type: "arrow";
}

export interface ExcalidrawFrame extends ElementBase {
  readonly name: string;
  readonly type: "frame";
}

export type ExcalidrawElement =
  | ExcalidrawRectangle
  | ExcalidrawText
  | ExcalidrawArrow
  | ExcalidrawFrame;

/** A `.excalidraw` file. */
export interface ExcalidrawFile {
  readonly appState: {
    readonly gridSize: null;
    readonly viewBackgroundColor: string;
  };
  readonly elements: ReadonlyArray<ExcalidrawElement>;
  readonly files: Readonly<Record<string, never>>;
  readonly source: string;
  readonly type: "excalidraw";
  readonly version: 2;
}

/** What `excalidrawOf` draws: a map and its layout. */
export interface ExcalidrawSource {
  /** The canvas colour. Defaults to the map's paper colour. */
  readonly background?: string | undefined;
  readonly data: MapData;
  readonly layout: Layout;
}

const { face, ink, paper } = palette.light;

/** Excalidraw's `ROUNDNESS.PROPORTIONAL_RADIUS`: corners rounded by size. */
const proportionalRadius = 3;

/** Cascadia, Excalidraw's monospace font, closest to the map's. */
const monospace = 3;

/** The largest a structure's name is set, and the smallest it shrinks to. */
const nameSize = 16;

const smallestNameSize = 10;

const labelSize = 14;

/** The width a hop's label wraps to, in screen units. */
const labelWidth = 140;

const lineHeight = 1.25;

/** An estimate of how wide monospace text is, as a share of its size. */
const charWidth = 0.6;

/** Room kept between a structure's name and its rectangle's edge. */
const namePadding = 8;

/** Opacity out of 100, for a structure that is switched off. */
const offOpacity = 50;

/** Opacity out of 100, for everything else. */
const fullOpacity = 100;

/** The stamp every element carries, so the file doesn't depend on the day. */
const fixedTime = 1;

/** FNV-1a's offset basis and prime, for 32-bit hashes. */
const fnvOffset = 2_166_136_261;

const fnvPrime = 16_777_619;

/** The element ids, one namespace per kind, so map ids can't clash. */
export const excalidrawIds = {
  group: (id: string) => `group:${id}`,
  hop: (id: string) => `hop:${id}`,
  label: (id: string) => `hop-label:${id}`,
  name: (id: string) => `structure-name:${id}`,
  structure: (id: string) => `structure:${id}`,
};

/** A stable 31-bit seed from an id: FNV-1a. */
const seedOf = (id: string) => {
  let hash = fnvOffset;

  for (const char of id) {
    hash ^= Option.getOrElse(Str.codePointAt(char, 0), () => 0);
    hash = Math.imul(hash, fnvPrime);
  }

  return (hash >>> 1) + 1;
};

const strokeStyles: Readonly<Record<Status, "solid" | "dashed">> = {
  live: "solid",
  off: "solid",
  planned: "dashed",
};

const opacities: Readonly<Record<Status, number>> = {
  live: fullOpacity,
  off: offOpacity,
  planned: fullOpacity,
};

const base = (
  id: string,
  rect: ScreenRect,
  frameId: string | null
): ElementBase => ({
  angle: 0,
  backgroundColor: "transparent",
  boundElements: [],
  created: fixedTime,
  fillStyle: "solid",
  frameId,
  groupIds: [],
  height: rect.bottom - rect.top,
  id,
  index: null,
  isDeleted: false,
  link: null,
  locked: false,
  opacity: fullOpacity,
  roughness: 0,
  roundness: null,
  seed: seedOf(id),
  strokeColor: ink,
  strokeStyle: "solid",
  strokeWidth: 1,
  updated: fixedTime,
  version: 1,
  versionNonce: 0,
  width: rect.right - rect.left,
  x: rect.left,
  y: rect.top,
});

/** The width of `text` set in monospace at `size`. */
const widthOf = (text: string, size: number) => text.length * size * charWidth;

/** Breaks a word longer than `chars` into pieces that fit. */
const pieces = (word: string, chars: number): ReadonlyArray<string> =>
  word.length <= chars
    ? [word]
    : [Str.slice(0, chars)(word), ...pieces(Str.slice(chars)(word), chars)];

/**
 * Breaks `text` into lines at spaces, none wider than `width` when set at
 * `size`. A word wider than a line is cut.
 */
const wrap = ({
  size,
  text,
  width,
}: {
  readonly size: number;
  readonly text: string;
  readonly width: number;
}): ReadonlyArray<string> => {
  const chars = Math.max(1, Math.floor(width / (size * charWidth)));

  return Arr.reduce(
    Arr.flatMap(Str.split(text, " "), (word) => pieces(word, chars)),
    Arr.empty<string>(),
    (lines, word) => {
      const last = lines.at(-1);

      return last !== undefined && last.length + 1 + word.length <= chars
        ? [...lines.slice(0, -1), `${last} ${word}`]
        : [...lines, word];
    }
  );
};

/** Text wrapped and sized to fit a box, as Excalidraw would lay it out. */
interface Fitted {
  readonly lines: ReadonlyArray<string>;
  readonly size: number;
}

/** The largest size, from `size` down, whose wrapped lines fit the box. */
const fitted = ({
  box,
  size,
  text,
}: {
  readonly box: { readonly height: number; readonly width: number };
  readonly size: number;
  readonly text: string;
}): Fitted => {
  const lines = wrap({ size, text, width: box.width });

  return size <= smallestNameSize ||
    lines.length * size * lineHeight <= box.height
    ? { lines, size }
    : fitted({ box, size: size - 1, text });
};

/**
 * Text centred on `centre` and bound to `containerId`. Excalidraw doesn't
 * wrap text when it loads a file, so `text` holds the wrapped lines and
 * `originalText` the whole text.
 */
const boundText = ({
  centre,
  containerId,
  fit,
  frameId,
  id,
  text,
}: {
  readonly centre: ScreenPoint;
  readonly containerId: string;
  readonly fit: Fitted;
  readonly frameId: string | null;
  readonly id: string;
  readonly text: string;
}): ExcalidrawText => {
  const width = Math.max(
    ...Arr.map(fit.lines, (line) => widthOf(line, fit.size))
  );

  const height = fit.lines.length * fit.size * lineHeight;

  return {
    ...base(
      id,
      {
        bottom: centre.sy + height / 2,
        left: centre.sx - width / 2,
        right: centre.sx + width / 2,
        top: centre.sy - height / 2,
      },
      frameId
    ),
    autoResize: true,
    baseFontSize: null,
    containerId,
    fontFamily: monospace,
    fontSize: fit.size,
    labelPosition: null,
    lineHeight,
    originalText: text,
    text: Arr.join(fit.lines, "\n"),
    textAlign: "center",
    type: "text",
    verticalAlign: "middle",
  };
};

const clampShare = (value: number) => Math.min(1, Math.max(0, value));

const bindingTo = (
  elementId: string,
  rect: ScreenRect,
  at: ScreenPoint
): ExcalidrawBinding => ({
  elementId,
  fixedPoint: [
    clampShare((at.sx - rect.left) / Math.max(rect.right - rect.left, 1)),
    clampShare((at.sy - rect.top) / Math.max(rect.bottom - rect.top, 1)),
  ],
  focus: 0,
  gap: 1,
  mode: "orbit",
});

const middleOf = (rect: ScreenRect): ScreenPoint => ({
  sx: (rect.left + rect.right) / 2,
  sy: (rect.top + rect.bottom) / 2,
});

/** The point halfway along a route, by length. */
const halfway = (points: ReadonlyArray<ScreenPoint>): ScreenPoint => {
  const legs = Arr.map(segmentsOf(points), (leg) => ({
    ...leg,
    length: segmentLength(leg),
  }));

  let left = Arr.reduce(legs, 0, (sum, leg) => sum + leg.length) / 2;

  for (const leg of legs) {
    if (left <= leg.length && leg.length > 0) {
      return lerp({ from: leg.start, t: left / leg.length, to: leg.end });
    }

    left -= leg.length;
  }

  return points[0] ?? { sx: 0, sy: 0 };
};

/** Whether `inner` lies inside `outer`. */
const within = (inner: ScreenRect, outer: ScreenRect) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.right <= outer.right &&
  inner.bottom <= outer.bottom;

const rectOfElement = (element: ElementBase): ScreenRect => ({
  bottom: element.y + element.height,
  left: element.x,
  right: element.x + element.width,
  top: element.y,
});

/**
 * The whole map as an Excalidraw file, at Plan view's positions: every
 * structure with a placement as a rectangle with its name inside, every hop
 * between them as an arrow bound to both ends with its label on it, and
 * every group with placed structures as a frame around them. A rectangle,
 * its name and every arrow between two members of the same group sit in that
 * group's frame.
 */
export const excalidrawOf = ({
  background = paper,
  data,
  layout,
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
    Arr.map(scene.structures, ({ outline, structure }) => [
      structure.id,
      boundsOfPoints(outline),
    ])
  );

  const zoneBounds = new Map(
    Arr.map(scene.zones, ({ bounds, zone }) => [
      excalidrawIds.group(zone.group.id),
      bounds,
    ])
  );

  /**
   * The frame an arrow and its label belong to: the group both ends share,
   * when the arrow and its label lie inside the group's frame. A frame clips
   * what sticks out of it, so anything that does stays outside.
   */
  const hopFrame = (
    from: string,
    to: string,
    parts: ReadonlyArray<ScreenRect>
  ) => {
    const frame = frameOf.get(from);
    const bounds = frame === undefined ? undefined : zoneBounds.get(frame);

    return frame !== undefined &&
      frame === frameOf.get(to) &&
      bounds !== undefined &&
      Arr.every(parts, (part) => within(part, bounds))
      ? frame
      : null;
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
        ? [{ id: excalidrawIds.hop(hop.id), type: "arrow" as const }]
        : []
    );

    const rectangle: ExcalidrawRectangle = {
      ...base(id, rect, frameId),
      backgroundColor: face,
      boundElements: [
        { id: excalidrawIds.name(structure.id), type: "text" },
        ...arrows,
      ],
      opacity: opacities[structure.status],
      roundness: { type: proportionalRadius },
      strokeStyle: strokeStyles[structure.status],
      type: "rectangle",
    };

    return [
      rectangle,
      boundText({
        centre: middleOf(rect),
        containerId: id,
        fit: fitted({
          box: {
            height: rect.bottom - rect.top - 2 * namePadding,
            width: rect.right - rect.left - 2 * namePadding,
          },
          size: nameSize,
          text: structure.name,
        }),
        frameId,
        id: excalidrawIds.name(structure.id),
        text: structure.name,
      }),
    ];
  });

  const hops = Arr.flatMap(scene.hops, ({ hop, label, points }) => {
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

    const labelFit = fitted({
      box: { height: Number.POSITIVE_INFINITY, width: labelWidth },
      size: labelSize,
      text: hop.label,
    });

    const text = boundText({
      centre: label === undefined ? halfway(points) : middleOf(label),
      containerId: id,
      fit: labelFit,
      frameId: null,
      id: excalidrawIds.label(hop.id),
      text: hop.label,
    });

    const frameId = hopFrame(hop.from, hop.to, [
      boundsOfPoints(points),
      rectOfElement(text),
    ]);

    const arrow: ExcalidrawArrow = {
      ...base(id, boundsOfPoints(points), frameId),
      boundElements: [{ id: excalidrawIds.label(hop.id), type: "text" }],
      elbowed: false,
      endArrowhead: "arrow",
      endBinding: bindingTo(excalidrawIds.structure(hop.to), to, last),
      points: Arr.map(
        points,
        ({ sx, sy }) => [sx - first.sx, sy - first.sy] as const
      ),
      startArrowhead: null,
      startBinding: bindingTo(excalidrawIds.structure(hop.from), from, first),
      type: "arrow",
      x: first.sx,
      y: first.sy,
    };

    return [arrow, { ...text, frameId }];
  });

  // Frames come after their members, as Excalidraw orders them.
  const frames = Arr.map(scene.zones, ({ bounds, zone }): ExcalidrawFrame => ({
    ...base(excalidrawIds.group(zone.group.id), bounds, null),
    name: zone.group.title,
    type: "frame",
  }));

  return {
    appState: { gridSize: null, viewBackgroundColor: background },
    elements: [...structures, ...hops, ...frames],
    files: {},
    source: "https://github.com/mippbipp/axonometric",
    type: "excalidraw",
    version: 2,
  };
};

/** The text of a `.excalidraw` file, as the page and `export` both save it. */
export const excalidrawText = (file: ExcalidrawFile) =>
  // oxlint-disable-next-line effecttsgo/global-json -- excalidrawOf's output is plain JSON data by construction
  `${JSON.stringify(file, null, 2)}\n`;
