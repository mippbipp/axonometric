/// <reference lib="webworker" />
// The page's slow checks and drawings, off its main thread. Each check routes
// and draws every chapter, which takes seconds on a big map. The page starts
// one worker for the drag warnings, one for the add form and one for drawing
// a map it hasn't drawn, and each hears only its own kind of message: a map
// once, then drag steps or drafts on it, or maps to draw. A newer step, draft
// or map stops the one before, and the add form stops its draft when it
// closes.

import { Result, Schema } from "effect";

import { draftChecker, DraftRequest } from "./draft-check.ts";
import { CheckRequest, dragChecker } from "./drag-check.ts";
import { SceneAsk, sceneDrawer } from "./scene-draw.ts";

const decodeRequest = Schema.decodeUnknownResult(
  Schema.Union([CheckRequest, DraftRequest, SceneAsk])
);

const post = (found: unknown) => {
  postMessage(found);
};

/** Each checker starts on its first message, so a worker runs only its own. */
interface Checkers {
  drafts?: ReturnType<typeof draftChecker>;
  drags?: ReturnType<typeof dragChecker>;
  scenes?: ReturnType<typeof sceneDrawer>;
}

const checkers: Checkers = {};

addEventListener("message", (event: MessageEvent<unknown>) => {
  const decoded = decodeRequest(event.data);

  if (Result.isFailure(decoded)) {
    return;
  }

  const request = decoded.success;

  if (request.kind === "scene ask") {
    checkers.scenes ??= sceneDrawer(post);
    checkers.scenes.ask(request);
  } else if (request.kind === "map" || request.kind === "step") {
    checkers.drags ??= dragChecker(post);

    if (request.kind === "map") {
      checkers.drags.map(request);
    } else {
      checkers.drags.step(request);
    }
  } else {
    checkers.drafts ??= draftChecker(post);

    if (request.kind === "draft map") {
      checkers.drafts.map(request);
      checkers.drafts.warm();
    } else if (request.kind === "draft ask") {
      checkers.drafts.ask(request);
    } else {
      checkers.drafts.stop();
    }
  }
});
