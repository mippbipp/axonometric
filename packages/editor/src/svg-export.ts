import { exportFontStack, whiteBackground } from "@axonometric/contracts";
import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

// Turns the drawn map into a standalone SVG file: the drawing at its full
// extent, with every computed colour, dash and font written onto the
// elements as presentation attributes, so it draws the same with no
// stylesheet. Packets, the selection, hover-only labels and everything
// interactive are left out, and ids are prefixed so several exports can sit
// in one page.

const svgNs = "http://www.w3.org/2000/svg";

/** Space around the drawing, in drawing units. */
const margin = 16;

/**
 * Where the measuring copy sits while it's drawn, far enough left to be out
 * of sight.
 */
const offscreen = "-100000px";

/** Elements the export leaves out: things that move, select or only show on hover. */
const strippedSelector = [
  "[data-packets]",
  "[data-selection-marker]",
  // The Iso view's ring pulses; Plan view's tint is still, and stays.
  "polygon[data-new-marker]",
  '[data-hop-label-fits="false"]',
  'polyline[stroke="transparent"]',
].join(", ");

/**
 * Elements that carry no meaning of their own: every line and fill. The
 * text, the names, labels, codes and zone titles, stays readable.
 */
const decorativeSelector =
  "defs, rect, polygon, polyline, path, circle, ellipse, line";

/** The parts that keep an id in the file, from the map's own ids. */
const namedParts = [
  ["data-structure", "structure"],
  ["data-hop", "hop"],
  ["data-zone", "zone"],
] as const;

/** Attributes only the live page uses. */
const interactiveAttribute = (name: string) =>
  name === "class" ||
  name === "style" ||
  name === "role" ||
  name === "tabindex" ||
  name === "inert" ||
  name === "cursor" ||
  name === "pointer-events" ||
  name.startsWith("data-") ||
  name.startsWith("aria-") ||
  name.startsWith("on");

/** Properties that inherit, written only where they differ from the parent. */
const inherited = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linejoin",
  "stroke-linecap",
  "paint-order",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
] as const;

interface Rgba {
  readonly hex: string;
  readonly alpha: number;
}

const channel = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * Reads a colour as sRGB through relative colour syntax, which turns any
 * computed form, such as `oklab()` or `color-mix()`, into `color(srgb ...)`.
 */
const colourReader = (document: Document) => {
  const probe = document.createElement("span");
  const cache = new Map<string, Rgba | undefined>();

  document.body.append(probe);

  const read = (value: string): Rgba | undefined => {
    const cached = cache.get(value);

    if (cached !== undefined || cache.has(value)) {
      return cached;
    }

    probe.style.color = "";
    probe.style.color = `rgb(from ${value} r g b / alpha)`;

    const computed = getComputedStyle(probe).color;

    // Chromium writes relative colours as color(srgb r g b / a), with
    // channels from 0 to 1; other browsers may write rgb() from 0 to 255.
    const srgb =
      /color\(srgb (?<r>[\d.e-]+) (?<g>[\d.e-]+) (?<b>[\d.e-]+)(?: \/ (?<a>[\d.e-]+))?\)/u.exec(
        computed
      )?.groups;

    const rgb =
      /rgba?\((?<r>[\d.]+),? (?<g>[\d.]+),? (?<b>[\d.]+)(?:[,/] ?(?<a>[\d.]+))?\)/u.exec(
        computed
      )?.groups;

    const groups = srgb ?? rgb;
    const range = srgb === undefined ? 255 : 1;

    const result =
      groups === undefined
        ? undefined
        : {
            hex: `#${channel(Number(groups.r) / range)}${channel(Number(groups.g) / range)}${channel(Number(groups.b) / range)}`,
            alpha: groups.a === undefined ? 1 : Number(groups.a),
          };

    cache.set(value, result);

    return result;
  };

  return { read, done: () => probe.remove() };
};

const urlReference = /url\(["']?#(?<id>[^"')]+)["']?\)/u;

/**
 * A paint's value as attributes: `none`, a `url(#id)` reference, or a hex
 * colour with its alpha folded into the matching opacity.
 */
const paintOf = (
  value: string,
  opacity: string,
  read: (value: string) => Rgba | undefined
): readonly [string, string] => {
  if (value === "none") {
    return ["none", opacity];
  }

  const reference = urlReference.exec(value);

  if (reference !== null) {
    return [`url(#${reference.groups?.id ?? ""})`, opacity];
  }

  const colour = read(value);

  if (colour === undefined || colour.alpha === 0) {
    return ["none", opacity];
  }

  return [colour.hex, String(Number(opacity) * colour.alpha)];
};

const unitless = (value: string) => value.replace(/px$/u, "");

/** The computed values the export writes for one element, as attributes. */
const presentationOf = (
  style: CSSStyleDeclaration,
  read: (value: string) => Rgba | undefined
): ReadonlyMap<string, string> => {
  const [fill, fillOpacity] = paintOf(
    style.fill,
    style.fillOpacity || "1",
    read
  );

  const [stroke, strokeOpacity] = paintOf(
    style.stroke,
    style.strokeOpacity || "1",
    read
  );

  return new Map([
    ["fill", fill],
    ["fill-opacity", fillOpacity],
    ["stroke", stroke],
    ["stroke-opacity", strokeOpacity],
    ["stroke-width", unitless(style.strokeWidth)],
    [
      "stroke-dasharray",
      style.strokeDasharray === "none"
        ? "none"
        : style.strokeDasharray.replaceAll("px", "").replaceAll(",", ""),
    ],
    ["stroke-linejoin", style.strokeLinejoin],
    ["stroke-linecap", style.strokeLinecap],
    ["paint-order", style.paintOrder],
    ["font-size", unitless(style.fontSize)],
    ["font-weight", style.fontWeight],
    [
      "letter-spacing",
      style.letterSpacing === "normal" ? "0" : unitless(style.letterSpacing),
    ],
    ["text-anchor", style.textAnchor],
  ]);
};

/**
 * Writes the computed styles of every element under `live` onto the matching
 * element of `clone`, a deep clone of it, so the clone draws the same with
 * no stylesheet. Elements that don't display are removed, and text set in
 * capitals by CSS is written in capitals.
 */
const inlineStyles = (live: Element, clone: Element) => {
  const { read, done } = colourReader(live.ownerDocument);
  const lives = [live, ...live.querySelectorAll("*")];
  const clones = [clone, ...clone.querySelectorAll("*")];
  const written = new Map<Element, ReadonlyMap<string, string>>();
  const hidden: Element[] = [];

  lives.forEach((element, index) => {
    const copy = clones[index];

    if (copy === undefined) {
      return;
    }

    const style = getComputedStyle(element);

    if (style.display === "none") {
      hidden.push(copy);

      return;
    }

    const values = presentationOf(style, read);
    const parent = element === live ? null : element.parentElement;
    const above = parent === null ? undefined : written.get(parent);

    written.set(element, values);

    for (const name of inherited) {
      const value = values.get(name);

      // An attribute the markup set may differ from what CSS drew, so it's
      // always rewritten.
      if (
        value !== undefined &&
        (value !== above?.get(name) || copy.hasAttribute(name))
      ) {
        copy.setAttribute(name, value);
      }
    }

    if (style.opacity !== "1") {
      copy.setAttribute("opacity", style.opacity);
    }

    if (element.localName === "text") {
      copy.setAttribute("font-family", exportFontStack);

      if (style.textTransform === "uppercase") {
        copy.textContent = (element.textContent ?? "").toUpperCase();
      }
    }
  });

  for (const element of hidden) {
    element.remove();
  }

  done();
};

const referenceAttributes = new Set(["aria-labelledby", "aria-describedby"]);

/**
 * Gives every id under `root` the name `rename` returns, and updates every
 * `url(#id)`, `#id` link and id list that points at one.
 */
const renameIds = (
  root: Element,
  rename: (element: Element, index: number) => string
) => {
  const elements = [root, ...root.querySelectorAll("*")];
  const names = new Map<string, string>();

  elements.forEach((element, index) => {
    if (element.id !== "") {
      names.set(element.id, rename(element, index));
    }
  });

  const renamed = (id: string) => names.get(id) ?? id;

  for (const element of elements) {
    if (element.id !== "") {
      element.id = renamed(element.id);
    }

    for (const attribute of element.attributes) {
      const { name, value } = attribute;

      if (name === "href" || name === "xlink:href") {
        if (value.startsWith("#")) {
          attribute.value = `#${renamed(value.slice(1))}`;
        }
      } else if (referenceAttributes.has(name)) {
        attribute.value = value
          .split(/\s+/u)
          .map((id) => renamed(id))
          .join(" ");
      } else if (value.includes("url(")) {
        attribute.value = value.replaceAll(
          /url\(["']?#(?<id>[^"')]+)["']?\)/gu,
          (_match, id: string) => `url(#${renamed(id)})`
        );
      }
    }
  }
};

/**
 * Replaces the ids React made with ones that depend only on what the
 * element is and where it sits, so two exports of the same map match.
 */
const stableIds = (root: Element) => {
  const counts = new Map<string, number>();

  renameIds(root, (element) => {
    const count = (counts.get(element.localName) ?? 0) + 1;

    counts.set(element.localName, count);

    return `${element.localName}-${count}`;
  });
};

/** What the export says about itself, for assistive technology. */
export interface ExportLabel {
  /** Prefixes every id in the file. */
  readonly prefix: string;
  readonly title: string;
  readonly description: string;
  /** The colour behind the drawing: the page's paper, or white. */
  readonly background: "paper" | "white";
}

/** The drawing's extent in its own units. */
export interface ExportBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Cleans up `clone`, an `<svg>` holding a copy of the drawing with its
 * styles inlined: leaves out what the export doesn't draw, strips the live
 * page's attributes, hides decorative parts from assistive technology,
 * prefixes the ids, and frames `bounds` with a background, a `<title>` and a
 * `<desc>`. It changes `clone` in place and returns it.
 */
export const cleanSvg = ({
  clone,
  label,
  bounds,
}: {
  readonly clone: SVGSVGElement;
  readonly label: Omit<ExportLabel, "background"> & {
    readonly background: string;
  };
  readonly bounds: ExportBounds;
}): SVGSVGElement => {
  const { ownerDocument: document } = clone;

  for (const element of clone.querySelectorAll(strippedSelector)) {
    element.remove();
  }

  // Each structure's accessible name becomes its title, so a structure whose
  // name tag shows its short tag still carries its full name.
  for (const element of clone.querySelectorAll(
    "[data-structure][aria-label]"
  )) {
    const name = document.createElementNS(svgNs, "title");

    name.textContent = element.getAttribute("aria-label");
    element.prepend(name);
  }

  stableIds(clone);

  for (const [attribute, kind] of namedParts) {
    for (const element of clone.querySelectorAll(`[${attribute}]`)) {
      element.id = `${kind}-${element.getAttribute(attribute) ?? ""}`;
    }
  }

  for (const element of clone.querySelectorAll(decorativeSelector)) {
    element.setAttribute("aria-hidden", "true");
  }

  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) {
      if (interactiveAttribute(name) && name !== "aria-hidden") {
        element.removeAttribute(name);
      }
    }
  }

  const x = bounds.x - margin;
  const y = bounds.y - margin;
  const width = Math.ceil(bounds.width + margin * 2);
  const height = Math.ceil(bounds.height + margin * 2);

  const background = document.createElementNS(svgNs, "rect");

  background.setAttribute("x", String(x));
  background.setAttribute("y", String(y));
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", label.background);
  background.setAttribute("stroke", "none");
  background.setAttribute("aria-hidden", "true");

  const title = document.createElementNS(svgNs, "title");
  const description = document.createElementNS(svgNs, "desc");

  title.id = "title";
  title.textContent = label.title;
  description.id = "desc";
  description.textContent = label.description;

  clone.prepend(title, description, background);
  clone.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-labelledby", "title desc");
  clone.setAttribute("font-family", exportFontStack);
  renameIds(clone, (element) => `${label.prefix}${element.id}`);

  return clone;
};

/** An SVG file's text and its size in pixels. */
export interface SvgFile {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Reads the computed styles in the light palette when `light` is set, and
 * puts the page's theme back before anything paints.
 */
const inTheme = <A>(document: Document, light: boolean, read: () => A): A => {
  const root = document.documentElement;
  const before = root.dataset.theme;

  if (light) {
    root.dataset.theme = "light";
  }

  try {
    return read();
  } finally {
    if (before === undefined) {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = before;
    }
  }
};

/**
 * The drawing in `world`, the map's pan-and-zoom group, as a standalone SVG
 * file at its full extent, with the camera left out. A white background
 * draws in the light palette, so dark-theme ink doesn't vanish on it.
 */
export const exportSvg = ({
  world,
  label,
}: {
  readonly world: SVGGElement;
  readonly label: ExportLabel;
}): Effect.Effect<SvgFile, ExportFailed> => {
  const { ownerDocument: document } = world;
  const clone = document.createElementNS(svgNs, "svg");
  const copy = world.cloneNode(true);

  if (!(copy instanceof SVGGElement)) {
    return Effect.fail(
      ExportFailed.make({ reason: "The browser couldn't copy the drawing." })
    );
  }

  const paper = inTheme(document, label.background === "white", () => {
    inlineStyles(world, copy);

    const { read, done } = colourReader(document);
    const colour = read("var(--paper)")?.hex;

    done();

    return colour;
  });

  const background =
    label.background === "white" ? whiteBackground : (paper ?? whiteBackground);

  copy.removeAttribute("transform");
  clone.append(copy);

  for (const element of clone.querySelectorAll(strippedSelector)) {
    element.remove();
  }

  // Measure what's left by drawing it, out of sight, in the page.
  const holder = document.createElement("div");

  holder.style.position = "absolute";
  holder.style.left = offscreen;
  holder.style.top = "0";
  holder.append(clone);
  document.body.append(holder);

  const box = copy.getBBox();

  holder.remove();
  cleanSvg({ clone, label: { ...label, background }, bounds: box });

  return Effect.succeed({
    text: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`,
    width: Number(clone.getAttribute("width")),
    height: Number(clone.getAttribute("height")),
  });
};

/** An export couldn't be made, for a reason the engineer can read. */
export class ExportFailed extends Schema.TaggedError<
  ExportFailed,
  { readonly brand: unique symbol }
>()("ExportFailed", {
  reason: Schema.String,
}) {}

/**
 * Draws an SVG file to a canvas at `scale` and returns it as a PNG. The SVG
 * goes to the image as a `data:` URL, which doesn't taint the canvas the way
 * a `blob:` URL can on a page opened from disk.
 */
export const pngOf: {
  (scale: number): (svg: SvgFile) => Effect.Effect<Blob, ExportFailed>;
  (svg: SvgFile, scale: number): Effect.Effect<Blob, ExportFailed>;
} = dual(2, (svg: SvgFile, scale: number) =>
  Effect.gen(function* () {
    const image = new Image();

    image.width = svg.width;
    image.height = svg.height;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.text)}`;

    yield* Effect.tryPromise({
      try: () => image.decode(),
      catch: () =>
        ExportFailed.make({ reason: "The browser couldn't draw the SVG." }),
    });

    const canvas = document.createElement("canvas");

    canvas.width = Math.round(svg.width * scale);
    canvas.height = Math.round(svg.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);

    return yield* Effect.callback<Blob, ExportFailed>((resume) => {
      canvas.toBlob((blob) => {
        resume(
          blob === null
            ? Effect.fail(
                ExportFailed.make({
                  reason: "The browser couldn't make a PNG of the map.",
                })
              )
            : Effect.succeed(blob)
        );
      }, "image/png");
    });
  })
);

/** How long a download link's object URL lives, so the save can start. */
const revokeAfterMs = 10_000;

/**
 * Saves `blob` as `name` through a download link, which works in the
 * read-only file opened from disk as well as the served page.
 */
export const download: {
  (name: string): (blob: Blob) => void;
  (blob: Blob, name: string): void;
} = dual(2, (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the save in some browsers.
  // oxlint-disable-next-line effecttsgo/global-timers -- the download link is plain DOM, outside any Effect runtime
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, revokeAfterMs);
});
