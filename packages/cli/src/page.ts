import { MapState, mapStateElementId } from "@axonometric/contracts";
import { Array as Arr, Effect, Schema, String as Str, pipe } from "effect";

import { editorPage } from "./editor-page.ts";

const encodeState = Schema.encodeEffect(Schema.fromJsonString(MapState));

const escapeHtml = (text: string) =>
  pipe(
    text,
    Str.replaceAll("&", "&amp;"),
    Str.replaceAll("<", "&lt;"),
    Str.replaceAll(">", "&gt;"),
    Str.replaceAll('"', "&quot;")
  );

/**
 * Puts `insert` in place of the first `marker` in `page`. Unlike
 * `String.replace`, a `$` in `insert` is kept as is.
 */
const splice = (page: string, marker: string, insert: string) => {
  const [before, ...after] = Str.split(marker)(page);

  return after.length === 0
    ? page
    : Arr.join([before, insert, Arr.join(after, marker)], "");
};

/**
 * Renders the read-only page: the editor's HTML with the map state inlined as
 * JSON. Every `<` is escaped, so no text in the map can close the script
 * element early.
 */
export const renderPage = Effect.fnUntraced(function* (state: MapState) {
  const page = yield* editorPage;
  const encoded = yield* encodeState(state);

  const json = Str.replaceAll("<", String.raw`\u003c`)(encoded);
  const script = `<script type="application/json" id="${mapStateElementId}">${json}</script>`;
  const title = `<title>${escapeHtml(state.data.overview.title)} · axonometric</title>`;

  const titled = splice(page, "<title>axonometric</title>", title);

  return splice(titled, "</head>", `${script}\n</head>`);
});
