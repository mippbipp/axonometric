/// <reference lib="webworker" />
// The page's slow checks, off its main thread. Each routes and draws every
// chapter, which takes seconds on a big map. The page starts one worker for
// the drag warnings and one for the add form, and each hears only its own
// kind of message: a map once, then drag steps or drafts on it. A newer step
// or draft stops the one before, and the add form stops its draft when it
// closes.

import { Result, Schema } from "effect";

import { draftChecker, DraftRequest } from "./draft-check.ts";
import { CheckRequest, dragChecker } from "./drag-check.ts";

const decodeRequest = Schema.decodeUnknownResult(
  Schema.Union([CheckRequest, DraftRequest])
);

const post = (found: unknown) => {
  postMessage(found);
};

/** Each checker starts on its first message, so a worker runs only its own. */
interface Checkers {
  drafts?: ReturnType<typeof draftChecker>;
  drags?: ReturnType<typeof dragChecker>;
}

const checkers: Checkers = {};

addEventListener("message", (event: MessageEvent<unknown>) => {
  const decoded = decodeRequest(event.data);

  if (Result.isFailure(decoded)) {
    return;
  }

  const request = decoded.success;

  if (request.kind === "map" || request.kind === "step") {
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
    } else if (request.kind === "draft ask") {
      checkers.drafts.ask(request);
    } else {
      checkers.drafts.stop();
    }
  }
});
