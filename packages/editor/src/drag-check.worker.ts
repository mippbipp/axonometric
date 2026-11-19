/// <reference lib="webworker" />
// The drag warnings check, off the page's main thread. It routes and draws
// every chapter, which takes seconds on a big map. The page sends the map
// once, then each drag step; this answers with what the chapters checked so
// far find, the chapter on screen first. A newer step stops the one before.

import { Result, Schema } from "effect";

import { CheckRequest, dragChecker } from "./drag-check.ts";

const decodeRequest = Schema.decodeUnknownResult(CheckRequest);

const checker = dragChecker((found) => {
  postMessage(found);
});

addEventListener("message", (event: MessageEvent<unknown>) => {
  const decoded = decodeRequest(event.data);

  if (Result.isFailure(decoded)) {
    return;
  }

  const request = decoded.success;

  if (request.kind === "map") {
    checker.map(request);
  } else {
    checker.step(request);
  }
});
