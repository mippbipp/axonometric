import { MapState, mapStateElementId } from "@axonometric/contracts";
import { Result, Schema } from "effect";

const decodeState = Schema.decodeUnknownResult(Schema.fromJsonString(MapState));

export type InlineState =
  | { readonly ok: true; readonly state: MapState }
  | { readonly ok: false; readonly message: string };

/** Reads the map state that `axonometric build` inlined into the page. */
export const readInlineState = (document: Document): InlineState => {
  const element = document.querySelector(`#${mapStateElementId}`);

  if (element === null) {
    return {
      ok: false,
      message:
        "This page has no map in it. Run axonometric build <home> to make one.",
    };
  }

  const decoded = decodeState(element.textContent);

  return Result.isSuccess(decoded)
    ? { ok: true, state: decoded.success }
    : {
        ok: false,
        message: `The map in this page is invalid: ${decoded.failure.message}`,
      };
};
