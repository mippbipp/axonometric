import {
  MapState,
  mapStateElementId,
  ServedPage,
  servedPageElementId,
} from "@axonometric/contracts";
import { Array as Arr, Effect, Schema, String as Str, pipe } from "effect";

import { editorPage } from "./editor-page.ts";

const encodeState = Schema.encodeEffect(Schema.fromJsonString(MapState));

const encodeServed = Schema.encodeEffect(Schema.fromJsonString(ServedPage));

/** `json` in a script element. Every `<` is escaped, so no text can close it. */
const jsonScript = (id: string, json: string) =>
  `<script type="application/json" id="${id}">${Str.replaceAll("<", String.raw`\u003c`)(json)}</script>`;

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
 * Renders the page: the editor's HTML with the map state inlined as JSON.
 * Without `served`, it's the read-only page. With it, the page also carries
 * where the server's events are, and connects to them.
 */
export const renderPage = Effect.fnUntraced(function* (
  state: MapState,
  served?: ServedPage
) {
  const page = yield* editorPage;

  const scripts = [
    jsonScript(mapStateElementId, yield* encodeState(state)),
    ...(served === undefined
      ? []
      : [jsonScript(servedPageElementId, yield* encodeServed(served))]),
  ];

  const script = Arr.join(scripts, "\n");
  const title = `<title>${escapeHtml(state.system)} · axonometric</title>`;

  const titled = splice(page, "<title>axonometric</title>", title);

  return splice(titled, "</head>", `${script}\n</head>`);
});
