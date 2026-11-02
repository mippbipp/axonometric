import { convexOverlap, segmentCrosses } from "@axonometric/contracts";
import type { ScreenPoint } from "@axonometric/contracts";
import { Array as Arr } from "effect";

// What a view draws, measured in the page, for the tests that check that no
// text is drawn over text or a box.

/**
 * Everything drawn as text and every structure's drawn outline, in screen
 * pixels, plus each hop's first leg. Text boxes come from
 * `getBoundingClientRect`, except zone titles, which lie skewed along an
 * edge, so their box is their own box mapped through the skew. A
 * structure's outline is the convex hull of the corners of every polygon
 * and rect it draws, so a box that leans past its footprint still counts.
 * Parts that aren't shown, such as a planned box's hatching or a hop label
 * hidden at this zoom, don't count.
 */
export const drawingReport = `(() => {
  const toScreen = (element, points) => {
    const matrix = element.getScreenCTM();

    return points.map((point) => {
      const at = new DOMPoint(point.x, point.y).matrixTransform(matrix);

      return { x: at.x, y: at.y };
    });
  };

  const rectPolygon = (rect) => [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];

  const ownBox = (element) => {
    const box = element.getBBox();

    return toScreen(element, [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ]);
  };

  const hull = (points) => {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (list) => {
      const out = [];

      for (const point of list) {
        while (out.length >= 2 && cross(out.at(-2), out.at(-1), point) <= 0) {
          out.pop();
        }

        out.push(point);
      }

      out.pop();

      return out;
    };

    return [...half(sorted), ...half([...sorted].reverse())];
  };

  const text = [
    ...[...document.querySelectorAll("[data-name-tag]")].map((tag) => ({
      id: "tag:" + tag.dataset.nameTag,
      polygon: rectPolygon(tag.querySelector("rect").getBoundingClientRect()),
    })),
    ...[...document.querySelectorAll("[data-hop-label]")]
      .filter((label) => getComputedStyle(label).visibility !== "hidden")
      .map((label) => ({
      id: "label:" + label.dataset.hopLabel,
      polygon: rectPolygon(label.getBoundingClientRect()),
    })),
    ...[...document.querySelectorAll("[data-zone-title]")].map((title) => ({
      id: "title:" + title.closest("[data-zone]").dataset.zone,
      polygon: ownBox(title),
    })),
  ];

  // The strike through a structure proposed for deletion, as segments on screen.
  const strikes = [...document.querySelectorAll("[data-strike]")].map((line) => ({
    id: "strike:" + line.closest("[data-removed-mark]").dataset.removedMark,
    segment: toScreen(line, [
      { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
      { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
    ]),
  }));

  // The strike across a hop proposed for deletion, as segments on screen.
  const hopStrikes = [...document.querySelectorAll("[data-hop-strike]")].map((line) => ({
    id: "hop-strike:" + line.closest("[data-removed-hop-mark]").dataset.removedHopMark,
    segment: toScreen(line, [
      { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
      { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
    ]),
  }));

  // The edge handles of the structure that has them, as boxes on screen.
  const handles = [...document.querySelectorAll("[data-edge-handle]")].map((handle) => ({
    id: "handle:" + handle.dataset.edgeOwner + ":" + handle.dataset.edgeHandle,
    polygon: rectPolygon(handle.getBoundingClientRect()),
  }));

  // The line of a hop being drawn, as segments on screen, one per piece.
  const previews = [...document.querySelectorAll("[data-hop-preview]")].map((line) => ({
    id: "preview:" + line.dataset.hopPreview,
    segment: toScreen(line, [
      { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
      { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
    ]),
  }));

  const chips = [...document.querySelectorAll("[data-code-chip]")].map((chip) => ({
    id: "chip:" + chip.closest("[data-structure]").dataset.structure,
    // The chip's rendered box, with its stroke.
    polygon: rectPolygon(chip.getBoundingClientRect()),
  }));

  const structures = [...document.querySelectorAll("[data-structure]")].map(
    (structure) => ({
      id: "box:" + structure.dataset.structure,
      polygon: hull(
        [...structure.querySelectorAll("polygon, rect")]
          .filter((part) => part.getBoundingClientRect().width > 0)
          .flatMap((part) =>
          part.tagName === "rect" ? ownBox(part) : toScreen(part, [...part.points])
        )
      ),
    })
  );

  const state = JSON.parse(
    document.getElementById("axonometric-map-state").textContent
  );
  const sourceOf = new Map(state.data.hops.map((hop) => [hop.id, hop.from]));

  const firstLegs = [...document.querySelectorAll("[data-hop]")].map((hop) => {
    const [a, b] = hop.dataset.route.split(" ").slice(0, 2).map((pair) => {
      const [x, y] = pair.split(",").map(Number);

      return { x, y };
    });

    return {
      hop: hop.dataset.hop,
      from: sourceOf.get(hop.dataset.hop),
      leg: toScreen(document.querySelector("[data-viewport]"), [a, b]),
    };
  });

  return { text, chips, strikes, hopStrikes, previews, handles, structures, firstLegs };
})()`;

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Drawn {
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
}

export interface DrawingReport {
  readonly text: readonly Drawn[];
  /** Each structure's code chip, as the page draws it. */
  readonly chips: readonly Drawn[];
  /** The pieces of the cross through a structure proposed for deletion. */
  readonly strikes: readonly {
    readonly id: string;
    readonly segment: readonly { readonly x: number; readonly y: number }[];
  }[];
  /** The pieces of the cross through a hop proposed for deletion. */
  readonly hopStrikes: readonly {
    readonly id: string;
    readonly segment: readonly { readonly x: number; readonly y: number }[];
  }[];
  /** The legs of the line of a hop being drawn. */
  readonly previews: readonly {
    readonly id: string;
    readonly segment: readonly { readonly x: number; readonly y: number }[];
  }[];
  /** The edge handles on show, as boxes. */
  readonly handles: readonly Drawn[];
  readonly structures: readonly Drawn[];
  readonly firstLegs: readonly {
    readonly hop: string;
    readonly from: string;
    readonly leg: readonly { readonly x: number; readonly y: number }[];
  }[];
}

const toScreenPoints = (polygon: readonly Point[]): readonly ScreenPoint[] =>
  Arr.map(polygon, ({ x, y }) => ({ sx: x, sy: y }));

/**
 * Whether two drawn shapes overlap. Each is shrunk by half a pixel first,
 * so shapes the browser's rounding makes touch don't count.
 */
export const overlap = (a: readonly Point[], b: readonly Point[]) =>
  convexOverlap(shrink(toScreenPoints(a)), shrink(toScreenPoints(b)));

/** A convex polygon pulled half a pixel towards its centre. */
const shrink = (polygon: readonly ScreenPoint[]): readonly ScreenPoint[] => {
  const count = Math.max(polygon.length, 1);
  const cx = Arr.reduce(polygon, 0, (sum, { sx }) => sum + sx) / count;
  const cy = Arr.reduce(polygon, 0, (sum, { sy }) => sum + sy) / count;

  return Arr.map(polygon, ({ sx, sy }) => {
    const length = Math.hypot(sx - cx, sy - cy) || 1;

    return {
      sx: sx - ((sx - cx) / length) * 0.5,
      sy: sy - ((sy - cy) / length) * 0.5,
    };
  });
};

/** Whether a segment runs through a drawn shape. */
export const crosses = (
  segment: readonly Point[],
  polygon: readonly Point[]
) => {
  const [start, end] = toScreenPoints(segment);

  return (
    start !== undefined &&
    end !== undefined &&
    segmentCrosses({ start, end }, shrink(toScreenPoints(polygon)))
  );
};
