import {
  chapterStopsOf,
  exportFontStack,
  exportName,
  palette,
  routeRevealed,
  sceneOf,
  whiteBackground,
} from "@axonometric/contracts";
import type { MapState, Spotlight, View } from "@axonometric/contracts";
import { String as Str } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { DrawingContext } from "./drawing-context.ts";
import type { DrawingEnvironment, Paint } from "./drawing-context.ts";
import { extentOf } from "./extent.ts";
import { FileFrame } from "./file-frame.tsx";
import { fontFaceCss } from "./font-face.ts";
import { MapDrawing } from "./map-drawing.tsx";
import { PassThrough } from "./pass-through.ts";

/** Space around the drawing, in drawing units. */
const margin = 16;

/** What an exported SVG is of, and how it looks. */
export interface SvgRequest {
  readonly state: MapState;
  readonly view: View;
  /** The chapter's index, from 0. */
  readonly chapter: number;
  /** The colour behind the drawing: the palette's paper, or white. */
  readonly background: "paper" | "white";
  /**
   * The palette to draw in. White always draws in the light palette, so
   * dark-theme ink doesn't vanish on it.
   */
  readonly theme: "light" | "dark";
  /**
   * What to draw at full strength, or `null` to fade nothing. The page
   * passes the spotlight it shows; the `export` command passes the chapter's
   * or the picked flow's, from `chapterSpotlightOf`.
   */
  readonly spotlight: Spotlight | null;
}

/** An SVG file's text and its size in pixels. */
export interface SvgFile {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

/** The drawing's text sizes are those of a view at real size. */
const exportZoom = 1;

const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n';

/**
 * Opening tags of elements that carry no meaning of their own, every line
 * and fill, that aren't already hidden. Text and attribute values escape
 * `<`, so a tag never hides in them.
 */
const decorative =
  /<(?<tag>defs|rect|polygon|polyline|path|circle|ellipse|line)(?![^>]* aria-hidden=)(?=[\s/>])/gu;

/**
 * The attributes only the live page uses. `data-faded` stays: it says which
 * parts the spotlight fades, for a reader of the file.
 */
const livePage = /\s(?:data-(?!faded=)[\w-]+|pointer-events)="[^"]*"/gu;

/**
 * Writes the finishing touches that need markup rather than components:
 * leaves out `data-*` attributes, except `data-faded`, and `pointer-events`,
 * which only the live page uses, and hides every decorative part from
 * assistive technology.
 */
const finished = (markup: string) =>
  Str.replaceAll(
    decorative,
    '<$<tag> aria-hidden="true"'
  )(Str.replaceAll(livePage, "")(markup));

const viewNames = {
  iso: "Iso view",
  plan: "Plan view",
} as const satisfies Record<View, string>;

/**
 * The map's drawing for a view and chapter as a standalone SVG file, with no
 * browser: the shared drawing components rendered to markup, in a palette
 * instead of the page's CSS variables. The page's Export menu and the
 * `export` command both call this, so they write the same file.
 *
 * It holds the drawing at its full extent with an accessible title and
 * description, ids prefixed with the export's name, and decorative parts
 * hidden from assistive technology. Parts outside the spotlight are faded.
 * Packets, the selection, the new-structure ring and hover-only labels are
 * left out.
 */
export const svgFileOf = ({
  state,
  view,
  chapter,
  background,
  theme,
  spotlight,
}: SvgRequest): SvgFile => {
  const stops = chapterStopsOf(state);
  const index = Math.min(Math.max(chapter, 0), stops.length - 1);
  const stop = stops[index] ?? stops[0];
  const number = index + 1;
  const { data, layout } = state;
  const prefix = `${exportName({ system: state.system, view, chapter: number })}-`;
  const palettes: Readonly<Record<"light" | "dark", Paint>> = palette;
  const paint = palettes[background === "white" ? "light" : theme];

  const scene = sceneOf({
    data,
    layout,
    revealed: stop.revealed,
    routes: routeRevealed({ data, layout, revealed: stop.revealed }),
    labelFirst: stop.plays,
    view,
    zoom: exportZoom,
  });

  const extent = extentOf({ scene, view });
  const x = extent.left - margin;
  const y = extent.top - margin;
  const width = Math.ceil(extent.right - extent.left + margin * 2);
  const height = Math.ceil(extent.bottom - extent.top + margin * 2);
  const title = `${data.overview.title}: ${viewNames[view]}, chapter ${number}`;
  const description = `${viewNames[view]} of ${data.overview.title}, at chapter ${number} of ${stops.length}, ${stop.title}. ${stop.lede}`;

  const environment: DrawingEnvironment = {
    paint,
    live: false,
    Frame: FileFrame,
    Layers: PassThrough,
    idOf: (kind, id) => `${prefix}${kind}-${id}`,
  };

  const markup = renderToStaticMarkup(
    <DrawingContext value={environment}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${x} ${y} ${width} ${height}`}
        width={width}
        height={height}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an <svg> has no <img> form; role="img" is how a standalone SVG is named for assistive technology.
        role="img"
        aria-labelledby={`${prefix}title ${prefix}desc`}
        fontFamily={exportFontStack}
        fontSize={12}
        // Text at the width the scene measured, as on the page.
        textRendering="geometricPrecision"
      >
        <title id={`${prefix}title`}>{title}</title>
        <desc id={`${prefix}desc`}>{description}</desc>
        {/* oxlint-disable-next-line shadcn/no-inline-styles -- a standalone SVG has no stylesheet to put its @font-face in */}
        <style>{fontFaceCss}</style>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={background === "white" ? whiteBackground : paint.paper}
          stroke="none"
          aria-hidden="true"
        />
        <MapDrawing
          scene={scene}
          hatch={`${prefix}pattern-1`}
          newlyRevealed={new Set(stop.newlyRevealed)}
          spotlight={spotlight}
        />
      </svg>
    </DrawingContext>
  );

  return {
    text: `${xmlDeclaration}${finished(markup)}\n`,
    width,
    height,
  };
};
