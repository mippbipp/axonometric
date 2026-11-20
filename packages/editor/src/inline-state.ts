import { MapState, mapStateElementId } from "@axonometric/contracts";
import { Result, Schema } from "effect";

const decodeState = Schema.decodeUnknownResult(Schema.fromJsonString(MapState));

export type InlineState =
  | { readonly ok: true; readonly state: MapState }
  | { readonly message: string; readonly ok: false };

/** Reads the map state that `axonometric build` inlined into the page. */
export const readInlineState = (document: Document): InlineState => {
  const element = document.querySelector(`#${mapStateElementId}`);

  if (element === null) {
    return {
      message:
        "This page has no map in it. Run axonometric build <home> to make one.",
      ok: false,
    };
  }

  const decoded = decodeState(element.textContent);

  return Result.isSuccess(decoded)
    ? { ok: true, state: decoded.success }
    : {
        message: `The map in this page is invalid: ${decoded.failure.message}`,
        ok: false,
      };
};
