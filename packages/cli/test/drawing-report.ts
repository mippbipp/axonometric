import { Array as Arr, String as Str } from "effect";

// What a view draws, measured in the page, for the tests that check that no
// text is drawn over text or a box.

/**
 * Everything drawn as text and every structure's drawn outline, in screen
 * pixels. Text boxes come from
 * `getBoundingClientRect`, except zone titles, which lie skewed along an
 * edge, so their box is their own box mapped through the skew. A
 * structure's outline is the convex hull of the corners of every polygon
 * and rect it draws, so a box that leans past its footprint still counts.
 * Parts that aren't shown, such as a planned box's hatching or a hop label
 * hidden at this zoom, don't count. Each hop's first leg is in
 * `firstLegsReport`.
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

  // The pending rings and lines the page draws for group and chapter
  // proposals: each piece is a straight run, as segments on screen.
  const rings = [
    ...document.querySelectorAll("[data-outline] polyline, [data-pending-zone] polyline"),
  ].map((line) => {
    const [a, b] = [...line.points];

    return {
      id:
        "ring:" +
        (line.closest("[data-outline]")?.dataset.outline ?? "?"),
      segment: toScreen(line, [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ]),
    };
  });

  return { text, chips, strikes, hopStrikes, previews, handles, rings, structures };
})()`;

/**
 * The first leg of every hop, in screen pixels, with the structure it leaves
 * from, as read from the page's embedded map state.
 */
export const firstLegsReport = `(() => {
  const state = JSON.parse(
    document.getElementById("axonometric-map-state").textContent
  );
  const sourceOf = new Map(state.data.hops.map((hop) => [hop.id, hop.from]));
  const matrix = document.querySelector("[data-viewport]").getScreenCTM();

  return [...document.querySelectorAll("[data-hop]")].map((hop) => ({
    hop: hop.dataset.hop,
    from: sourceOf.get(hop.dataset.hop),
    leg: hop.dataset.route.split(" ").slice(0, 2).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      const at = new DOMPoint(x, y).matrixTransform(matrix);

      return { x: at.x, y: at.y };
    }),
  }));
})()`;

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Drawn {
  readonly id: string;
  readonly polygon: readonly Point[];
}

/** A straight piece of a drawn line, from its first point to its second. */
export interface DrawnSegment {
  readonly id: string;
  readonly segment: readonly Point[];
}

export interface DrawingReport {
  readonly text: readonly Drawn[];
  /** Each structure's code chip, as the page draws it. */
  readonly chips: readonly Drawn[];
  /** The straight pieces of the pending rings and lines of group and chapter proposals. */
  readonly rings: readonly DrawnSegment[];
  /** The pieces of the cross through a structure proposed for deletion. */
  readonly strikes: readonly DrawnSegment[];
  /** The pieces of the cross through a hop proposed for deletion. */
  readonly hopStrikes: readonly DrawnSegment[];
  /** The legs of the line of a hop being drawn. */
  readonly previews: readonly DrawnSegment[];
  /** The edge handles on show, as boxes. */
  readonly handles: readonly Drawn[];
  readonly structures: readonly Drawn[];
}

/** A hop's first leg on screen, and the structure it leaves from. */
export interface FirstLeg {
  readonly hop: string;
  readonly from: string;
  readonly leg: readonly Point[];
}

/** The least and greatest of `points` along `axis`. */
const extentAlong = (points: readonly Point[], axis: Point) => {
  const along = Arr.map(points, ({ x, y }) => x * axis.x + y * axis.y);

  return { min: Math.min(...along), max: Math.max(...along) };
};

/** A normal to each edge of `points`, taken as a closed outline. */
const edgeNormals = (points: readonly Point[]): readonly Point[] =>
  Arr.map(points, (point, index) => {
    const next = points[(index + 1) % points.length] ?? point;

    return { x: next.y - point.y, y: point.x - next.x };
  });

/**
 * Whether two convex polygons share area, by the separating axis test: they
 * don't when their projections onto some edge normal of either are apart or
 * only touch.
 */
const shareArea = (a: readonly Point[], b: readonly Point[]) =>
  a.length > 0 &&
  b.length > 0 &&
  Arr.every([...edgeNormals(a), ...edgeNormals(b)], (axis) => {
    const first = extentAlong(a, axis);
    const second = extentAlong(b, axis);

    return first.min < second.max && second.min < first.max;
  });

/** A convex polygon pulled half a pixel towards its centre. */
const shrink = (polygon: readonly Point[]): readonly Point[] => {
  const count = Math.max(polygon.length, 1);
  const cx = Arr.reduce(polygon, 0, (sum, { x }) => sum + x) / count;
  const cy = Arr.reduce(polygon, 0, (sum, { y }) => sum + y) / count;

  return Arr.map(polygon, ({ x, y }) => {
    const length = Math.hypot(x - cx, y - cy) || 1;

    return {
      x: x - ((x - cx) / length) * 0.5,
      y: y - ((y - cy) / length) * 0.5,
    };
  });
};

/**
 * Whether two drawn shapes overlap. Each is shrunk by half a pixel first,
 * so shapes the browser's rounding makes touch don't count.
 */
export const overlap = (a: readonly Point[], b: readonly Point[]) =>
  shareArea(shrink(a), shrink(b));

/**
 * How many pixels of the segment from `start` to `end` lie inside the convex
 * polygon. Each edge keeps the part of the segment on the polygon's side of
 * it, the side its centre is on.
 */
const lengthInside = (start: Point, end: Point, polygon: readonly Point[]) => {
  const count = Math.max(polygon.length, 1);

  const centre = {
    x: Arr.reduce(polygon, 0, (sum, { x }) => sum + x) / count,
    y: Arr.reduce(polygon, 0, (sum, { y }) => sum + y) / count,
  };

  let from = 0;
  let to = 1;

  for (const [index, corner] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length] ?? corner;

    // How far a point is inside this edge, along its normal.
    const inside = ({ x, y }: Point) => {
      const side =
        (next.x - corner.x) * (y - corner.y) -
        (next.y - corner.y) * (x - corner.x);

      const centreSide =
        (next.x - corner.x) * (centre.y - corner.y) -
        (next.y - corner.y) * (centre.x - corner.x);

      return centreSide < 0 ? -side : side;
    };

    const atStart = inside(start);
    const atEnd = inside(end);

    if (atStart <= 0 && atEnd <= 0) {
      return 0;
    }

    if (atStart < 0) {
      from = Math.max(from, atStart / (atStart - atEnd));
    } else if (atEnd < 0) {
      to = Math.min(to, atStart / (atStart - atEnd));
    }
  }

  return Math.max(to - from, 0) * Math.hypot(end.x - start.x, end.y - start.y);
};

/**
 * Whether a segment runs through a drawn shape for more than half a pixel.
 * The shape is shrunk by half a pixel first, so a line the browser's
 * rounding puts on its edge doesn't count.
 */
export const crosses = (
  segment: readonly Point[],
  polygon: readonly Point[]
) => {
  const [start, end] = segment;

  return (
    start !== undefined &&
    end !== undefined &&
    lengthInside(start, end, shrink(polygon)) > 0.5
  );
};

/**
 * Every text drawn over other text, and every text drawn over a box, as
 * `<text> × <other>`. Text is what `drawingReport` lists as text: name tags,
 * shown hop labels and zone titles.
 */
export const textClashes = (report: DrawingReport): readonly string[] => [
  ...Arr.flatMap(report.text, (first, index) =>
    Arr.flatMap(Arr.drop(report.text, index + 1), (second) =>
      overlap(first.polygon, second.polygon)
        ? [`${first.id} × ${second.id}`]
        : []
    )
  ),
  ...Arr.flatMap(report.text, (text) =>
    Arr.flatMap(report.structures, (box) =>
      overlap(text.polygon, box.polygon) ? [`${text.id} × ${box.id}`] : []
    )
  ),
];

/**
 * Every name tag drawn over other text or over a box other than its own, as
 * `<tag> × <other>`, each pair once.
 */
export const nameTagClashes = (report: DrawingReport): readonly string[] => {
  const tags = Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id));

  const withText = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(report.text, ({ id }) => id !== tag.id),
      (other: Drawn) =>
        overlap(tag.polygon, other.polygon) ? [`${tag.id} × ${other.id}`] : []
    )
  );

  const withBoxes = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(
        report.structures,
        ({ id }) => id !== `box:${Str.slice(4)(tag.id)}`
      ),
      (box: Drawn) =>
        overlap(tag.polygon, box.polygon) ? [`${tag.id} × ${box.id}`] : []
    )
  );

  return Arr.dedupe([...withText, ...withBoxes]);
};
