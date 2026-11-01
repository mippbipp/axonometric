/**
 * The map's colours, light and dark. `index.css` in the editor writes the
 * same values as `light-dark(...)` pairs, and a test keeps the two equal.
 */
export const palette = {
  light: {
    paper: "#e6dfbe",
    ink: "#17170f",
    face: "#efe9cc",
    muted: "#8e8a70",
  },
  dark: {
    paper: "#1e1d15",
    ink: "#e6dfbe",
    face: "#2a2920",
    muted: "#6e6b54",
  },
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
