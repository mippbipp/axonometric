import {
  ServedPage,
  servedPageElementId,
  ServerEvent,
} from "@axonometric/contracts";
import type { MapState } from "@axonometric/contracts";
import { Duration, Effect, Option, Result, Schema } from "effect";

const decodeServed = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServedPage)
);

const decodeEvent = Schema.decodeUnknownResult(
  Schema.fromJsonString(ServerEvent)
);

/**
 * Where the server's events are, when `axonometric serve` served this page.
 * The read-only file from `build` has none.
 */
export const readServedPage = (document: Document): Option.Option<ServedPage> =>
  Option.flatMap(
    Option.fromNullOr(document.querySelector(`#${servedPageElementId}`)),
    (element) => decodeServed(element.textContent)
  );

/** What a served page shows. */
export interface Live {
  /** The last good map. */
  readonly state: MapState;
  /** Why the map files on disk don't make a map, or null when they do. */
  readonly error: string | null;
  /** Whether the page has lost its connection to the server. */
  readonly stopped: boolean;
}

export interface LiveStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Live;
}

/** How long to wait before reconnecting a stream the browser gave up on. */
const retryDelay = Duration.seconds(2);

/** What `connectLive` starts from. */
export interface LiveSource {
  /** The map inlined into the page. */
  readonly initial: MapState;
  readonly served: ServedPage;
}

/**
 * Connects to the server's events and keeps the latest map. The browser
 * reconnects a dropped stream on its own. It gives up instead after an error
 * response, such as a reverse proxy's 502 while the server is down, and then
 * the store starts a new stream.
 */
export const connectLive = ({ initial, served }: LiveSource): LiveStore => {
  const listeners = new Set<() => void>();
  let live: Live = { state: initial, error: null, stopped: false };

  const update = (next: Partial<Live>) => {
    live = { ...live, ...next };

    for (const listener of listeners) {
      listener();
    }
  };

  const connect = () => {
    const source = new EventSource(new URL(served.events, document.baseURI));

    source.addEventListener("open", () => {
      if (live.stopped) {
        update({ stopped: false });
      }
    });

    source.addEventListener("message", (message) => {
      const decoded = decodeEvent(message.data);

      if (Result.isFailure(decoded)) {
        return;
      }

      ServerEvent.match(decoded.success, {
        MapUpdated: ({ state }) => {
          update({ state, error: null, stopped: false });
        },
        MapRejected: ({ message: error }) => {
          update({ error, stopped: false });
        },
        Heartbeat: () => {},
      });
    });

    source.addEventListener("error", () => {
      if (!live.stopped) {
        update({ stopped: true });
      }

      if (source.readyState === EventSource.CLOSED) {
        source.close();
        Effect.runFork(reconnect);
      }
    });
  };

  const reconnect = Effect.sleep(retryDelay).pipe(
    Effect.andThen(Effect.sync(connect))
  );

  connect();

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => live,
  };
};
