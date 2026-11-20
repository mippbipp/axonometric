import { Revision } from "@axonometric/contracts";
import type { ServedPage } from "@axonometric/contracts";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

const decodeRevision = Schema.decodeUnknownOption(
  Schema.fromJsonString(Revision)
);

/** What reading a revision from the server gave. */
export type LoadedRevision =
  | { readonly ok: true; readonly revision: Revision }
  | { readonly message: string; readonly ok: false };

/**
 * Reads revision `n` from the server. The number comes from the history the
 * server listed, and goes into the path as digits.
 */
export const loadRevision = ({
  n,
  served,
}: {
  readonly n: number;
  readonly served: ServedPage;
}): Effect.Effect<LoadedRevision> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.get(
      new URL(`${served.history}/${n}`, document.baseURI)
    );

    const text = yield* response.text;

    if (response.status === 404) {
      return {
        message: `Revision ${n} is gone from the history folder.`,
        ok: false,
      } satisfies LoadedRevision;
    }

    return Option.match(decodeRevision(text), {
      onNone: (): LoadedRevision => ({
        message: `The server's answer for revision ${n} didn't make sense. Reload the page.`,
        ok: false,
      }),
      onSome: (revision): LoadedRevision => ({ ok: true, revision }),
    });
  }).pipe(
    Effect.catchTag("HttpClientError", () =>
      Effect.succeed<LoadedRevision>({
        message: `Revision ${n} couldn't be read: the server didn't answer. It may have stopped.`,
        ok: false,
      })
    ),
    Effect.scoped,
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each read runs on its own, so this is its entry point.
    Effect.provide(FetchHttpClient.layer)
  );
