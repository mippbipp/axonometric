/**
 * The map's colours, light and dark: the one table the page's stylesheet
 * and every exported file take their colours from. `index.css` in the editor
 * writes the same values as `light-dark(...)` pairs, named in kebab case
 * (`faceOff` is `--face-off`), and a test keeps the two equal. An export is
 * drawn in `palette.light`.
 *
 * `faceOff` is a switched-off structure's face: the face colour mixed 60%
 * of the way to paper in oklab.
 */
export const palette = {
  light: {
    paper: "#e6dfbe",
    ink: "#17170f",
    face: "#efe9cc",
    faceOff: "#eae3c4",
    muted: "#8e8a70",
  },
  dark: {
    paper: "#1e1d15",
    ink: "#e6dfbe",
    face: "#2a2920",
    faceOff: "#232219",
    muted: "#6e6b54",
  },
} as const;

/**
 * The dash patterns the drawing uses, as SVG `stroke-dasharray` values. The
 * page and every exported file draw them from here.
 */
export const dashes = {
  /** A planned structure's outline. */
  planned: "4 3",
  /** The faint stretch of a hop drawn over a box. */
  hidden: "4 3",
  /** An external structure's outer ring in the Iso view. */
  ring: "4 3",
  /** The pulsing ring round a newly revealed structure in the Iso view. */
  fresh: "5 4",
} as const;

/**
 * How strongly the parts outside the spotlight are drawn, as SVG `opacity`
 * values. The page and every exported file take them from here.
 */
export const fadedOpacity = {
  /** A hop's line, arrowhead, bend marks and label. */
  line: 0.25,
  /** A structure, with its name tag and code chip. */
  structure: 0.5,
} as const;

/** The "White background" option's colour. */
export const whiteBackground = "#ffffff";

/**
 * The one font the exports are drawn in. The CLI's PNG embeds it (Liberation
 * Mono, SIL OFL 1.1), so its output doesn't depend on the OS.
 */
export const exportFontFamily = "Liberation Mono";

/**
 * The `font-family` of an exported SVG: the bundled font first, then
 * monospace faces of similar width for a viewer that doesn't have it.
 */
export const exportFontStack = `"${exportFontFamily}", ui-monospace, Menlo, Consolas, monospace`;
