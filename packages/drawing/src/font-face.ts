import { exportFontFamily } from "@axonometric/contracts";

import { boldBase64, regularBase64 } from "./font-data.ts";

const faceOf = (weight: number, base64: string) =>
  `@font-face{font-family:${exportFontFamily};font-weight:${weight};src:url(data:font/woff2;base64,${base64})}`;

/**
 * The `@font-face` rules that make an exported SVG draw in Liberation Mono
 * wherever it's opened, with the fonts inside the file as data URLs. The
 * family name is unquoted so the rules need no escaping in markup.
 */
export const fontFaceCss = `${faceOf(400, regularBase64)}${faceOf(700, boldBase64)}`;
