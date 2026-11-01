// oxlint-disable-next-line effecttsgo/node-builtin-import -- NodeHttpServer takes a Node server to listen with
import { createServer } from "node:http";

import {
  formatCount,
  formatProblem,
  ServerEvent,
  serverPaths,
  splitProblems,
} from "@axonometric/contracts";
import type { MapState, Proposals, ServerState } from "@axonometric/contracts";
import { ServerApi } from "@axonometric/contracts/api";
import { NodeHttpServer } from "@effect/platform-node";
import {
  Array as Arr,
  Cause,
  Console,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Latch,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
  Scope,
  Stream,
  String as Str,
  SubscriptionRef,
} from "effect";
import { CliError } from "effect/cli";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { printNotes, rebuild } from "./build.ts";
import { withLock } from "./lock.ts";
import type { MapInvalid } from "./map-files.ts";
import { openBrowser } from "./open-browser.ts";
import { renderPage } from "./page.ts";
import { writeGuardLayer, writePendingLayout } from "./pending-writes.ts";
import { recordServer, runningServer } from "./server-state.ts";

/** The port `serve` tries first. */
export const defaultPort = 5178;

/** How many ports after `defaultPort` `serve` tries before giving up. */
const portsToTry = 20;

/** The address `serve` binds unless told otherwise. */
export const defaultHost = "127.0.0.1";

/**
 * The loopback names, as a Host header writes them. Every server answers
 * them, whatever `--allow-host` adds, and binding one of them keeps the
 * server off the network.
 */
const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"] as const;

/** The loopback names, for messages. */
const loopbackList = Arr.join(loopbackHosts, ", ");

const wildcardHosts = new Set(["0.0.0.0", "::", "[::]"]);

/** How long the watcher waits for a burst of saves to settle. */
const settleTime = Duration.millis(100);

/** How often the events stream sends a heartbeat. */
const heartbeatInterval = Duration.seconds(15);

/** Another server is running for this map. */
export class ServerRunning extends Schema.TaggedError<
  ServerRunning,
  { readonly brand: unique symbol }
>()("ServerRunning", { home: Schema.String, server: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `A server is already running for ${this.home} at ${this.server}. Open that URL, or stop that server first.`;
  }
}

/** The port given with `--port` is taken. */
export class PortBusy extends Schema.TaggedError<
  PortBusy,
  { readonly brand: unique symbol }
>()("PortBusy", { host: Schema.String, port: Schema.Int }) {
  public override get [CliError.userMessage]() {
    return `Port ${this.port} on ${this.host} is in use. Pick another with --port, or leave --port out to use the next free port.`;
  }
}

/** Every port `serve` tried is taken. */
export class NoFreePort extends Schema.TaggedError<
  NoFreePort,
  { readonly brand: unique symbol }
>()("NoFreePort", {
  host: Schema.String,
  first: Schema.Int,
  last: Schema.Int,
}) {
  public override get [CliError.userMessage]() {
    return `Ports ${this.first} to ${this.last} on ${this.host} are all in use. Pick a free one with --port.`;
  }
}

/** The server can't listen, for a reason other than a busy port. */
export class ListenFailed extends Schema.TaggedError<
  ListenFailed,
  { readonly brand: unique symbol }
>()("ListenFailed", { host: Schema.String, reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `serve could not listen on ${this.host}: ${this.reason}`;
  }
}

/** How `serve` was asked to run. */
export interface ServeOptions {
  readonly home: string;
  /** A port to use and nothing else, or none to find a free one. */
  readonly port: Option.Option<number>;
  readonly host: string;
  /** Host names to answer besides loopback, for a reverse proxy. */
  readonly allowHosts: readonly string[];
  readonly open: boolean;
}

/** What the map files say now, as serve holds it. */
interface Held {
  /** The last good map, with the accepted layout only. */
  readonly good: MapState;
  /** What `proposals.json` held when it last decoded. */
  readonly proposals: Proposals;
  /** The `MapRejected` saying why the map files don't make a map, while they don't. */
  readonly rejected: Option.Option<ServerEvent>;
}

/** The last good map with what's pending, as pages get it. */
const shownState = ({ good, proposals }: Held): MapState => ({
  ...good,
  proposals,
});

/** The events that describe `held` to a page. */
const eventsOf = (held: Held): readonly ServerEvent[] =>
  Option.match(held.rejected, {
    onNone: () => [
      ServerEvent.cases.MapUpdated.make({ state: shownState(held) }),
    ],
    onSome: (rejected) => [
      rejected,
      ServerEvent.cases.PendingUpdated.make({ proposals: held.proposals }),
    ],
  });

/** A Host header's name: a bracketed IPv6 address, or what's before a `:`. */
const hostPattern = /^(?<name>\[[^\]]*\]|[^:]*)/u;

/** The host name in a Host header, without its port. */
const hostName = (header: string) => {
  const host = Str.toLowerCase(Str.trim(header));

  return Option.match(Str.match(hostPattern)(host), {
    onNone: () => "",
    onSome: ([name]) => name,
  });
};

/** Brackets an IPv6 address, as a Host header and a URL write it. */
const urlHost = (host: string) =>
  Str.includes(":")(host) && !Str.startsWith("[")(host) ? `[${host}]` : host;

/**
 * Answers 403 to any request whose Host isn't one the server expects. This
 * stops a page on another site from reading the map through DNS rebinding.
 */
const hostCheck = (allowed: ReadonlySet<string>) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const header = request.headers.host;

        return header !== undefined && allowed.has(hostName(header))
          ? httpEffect
          : Effect.succeed(
              HttpServerResponse.text(
                `This server only answers requests addressed to ${loopbackList} or a host given with --allow-host.\n`,
                { status: 403 }
              )
            );
      }),
    { global: true }
  );

const isAddressInUse = (cause: unknown) =>
  Predicate.hasProperty(cause, "code") && cause.code === "EADDRINUSE";

const describeError = (cause: unknown) =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
    ? cause.message
    : String(cause);

/**
 * Listens on `port`, or reports that it's taken. The server closes when the
 * current scope does.
 */
const listenOn = (host: string, port: number) =>
  Effect.suspend(() => {
    const node = createServer();

    // Once the server stops answering, a browser may still send a request
    // down a kept-alive connection, which would then hang. Closing every
    // connection makes the page see the server go, and reconnect to the
    // next one.
    const closeConnections = Effect.addFinalizer(() =>
      Effect.sync(() => {
        node.closeAllConnections();
      })
    );

    return NodeHttpServer.make(() => node, {
      host,
      port,
      gracefulShutdownTimeout: Duration.seconds(1),
    }).pipe(Effect.tap(() => closeConnections));
  }).pipe(
    Effect.asSome,
    Effect.catchTag("ServeError", (error) =>
      isAddressInUse(error.cause)
        ? Effect.succeedNone
        : Effect.fail(
            ListenFailed.make({ host, reason: describeError(error.cause) })
          )
    )
  );

/** Listens on the port asked for, or the first free one from 5178. */
const listen = Effect.fnUntraced(function* (
  host: string,
  port: Option.Option<number>
) {
  if (Option.isSome(port)) {
    const server = yield* listenOn(host, port.value);

    return Option.isSome(server)
      ? server.value
      : yield* PortBusy.make({ host, port: port.value });
  }

  for (let next = defaultPort; next < defaultPort + portsToTry; next++) {
    const server = yield* listenOn(host, next);

    if (Option.isSome(server)) {
      return server.value;
    }
  }

  return yield* NoFreePort.make({
    host,
    first: defaultPort,
    last: defaultPort + portsToTry - 1,
  });
});

/** The port a listening server is bound to. */
const portOf = (server: HttpServer.HttpServer["Service"]) =>
  "port" in server.address ? server.address.port : 0;

/**
 * What serve says when a change breaks the map, before the problems: how
 * many errors, and that the page and the files on disk stay as they were.
 */
const summaryOf = (error: MapInvalid) =>
  `The map has ${formatCount(splitProblems(error.problems).errors.length, "error")}. Open pages keep the last good map until the files are fixed. SYSTEM.md and the HTML are unchanged.`;

/** The summary and the problems, as serve prints them. */
const printedRejection = (error: MapInvalid) =>
  Arr.join(
    [
      `${error.home}: ${summaryOf(error)}`,
      ...Arr.map(error.problems, (problem) => `  ${formatProblem(problem)}`),
    ],
    "\n"
  );

/**
 * Rebuilds the map and returns how what the server holds changes. A map
 * with errors keeps the last good map, and is printed.
 */
const rebuildHeld = (home: string) =>
  rebuild(home, "serve").pipe(
    Effect.tap(printNotes),
    Effect.map(({ state, proposals }) => (_held: Held): Held => ({
      good: state,
      proposals,
      rejected: Option.none(),
    })),
    Effect.catchTag("MapInvalid", (error) =>
      Effect.as(Console.error(printedRejection(error)), (held: Held): Held => ({
        ...held,
        rejected: Option.some(
          ServerEvent.cases.MapRejected.make({
            summary: summaryOf(error),
            problems: error.problems,
          })
        ),
      }))
    )
  );

const watchedFiles = new Set(["data.mjs", "layout.json", "proposals.json"]);

/**
 * Watches the home folder, not the files in it: editors often save by
 * writing a new file and renaming it over the old one, which a watch on the
 * old file would miss. Resolves `ready` once the watch is in place.
 */
const watchMap = (home: string, ready: Latch.Latch) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return fs
      .watch(home, {
        onReady: () => {
          ready.openUnsafe();
        },
      })
      .pipe(
        Stream.filter((event) => watchedFiles.has(path.basename(event.path))),
        Stream.debounce(settleTime)
      );
  }).pipe(Stream.unwrap);

/** A heartbeat every `heartbeatInterval`, starting after the first wait. */
const heartbeats = Stream.tick(heartbeatInterval).pipe(
  Stream.drop(1),
  Stream.as(ServerEvent.cases.Heartbeat.make({}))
);

/** The HTTP routes: the API, behind the Host check and the write guard. */
const routes = ({
  home,
  held,
  stopping,
  allowed,
  proxied,
}: {
  readonly home: string;
  readonly held: SubscriptionRef.SubscriptionRef<Held>;
  readonly stopping: Latch.Latch;
  readonly allowed: ReadonlySet<string>;
  readonly proxied: ReadonlySet<string>;
}) => {
  const events = SubscriptionRef.changes(held).pipe(
    Stream.flatMap((current) => Stream.fromIterable(eventsOf(current))),
    Stream.merge(heartbeats),
    // Open streams never end on their own, so they end when the server
    // starts to stop, and it doesn't wait for them.
    Stream.interruptWhen(stopping.await)
  );

  const served = {
    events: Str.slice(1)(serverPaths.events),
    pendingLayout: Str.slice(1)(serverPaths.pendingLayout),
  };

  const mapHandlers = HttpApiBuilder.group(ServerApi, "map", (group) =>
    group
      .handle("page", () =>
        SubscriptionRef.get(held).pipe(
          Effect.flatMap((current) => renderPage(shownState(current), served)),
          Effect.orDie
        )
      )
      .handle("state", () => Effect.map(SubscriptionRef.get(held), shownState))
      .handle("events", () => Effect.succeed(events))
  );

  const proposalHandlers = HttpApiBuilder.group(
    ServerApi,
    "proposals",
    (group) =>
      group.handle("putLayout", ({ payload }) =>
        writePendingLayout(home, payload).pipe(
          Effect.tap((proposals) =>
            SubscriptionRef.update(held, (current) => ({
              ...current,
              proposals,
            }))
          ),
          Effect.catchTag(
            ["PlatformError", "LockHeld", "SchemaError"],
            Effect.die
          )
        )
      )
  );

  const api = HttpApiBuilder.layer(ServerApi).pipe(
    Layer.provide([mapHandlers, proposalHandlers]),
    Layer.provide(writeGuardLayer(proxied))
  );

  return Layer.mergeAll(api, hostCheck(allowed)).pipe(
    Layer.provide(NodeHttpServer.layerHttpServices)
  );
};

/**
 * Runs the server for the map in `home` until interrupted. It writes its URL
 * and process ID to `.axonometric/server.json` and removes the file when it
 * stops.
 */
export const serve = Effect.fn("serve")(function* (options: ServeOptions) {
  const { home, host } = options;
  const scope = yield* Effect.scope;

  const other = yield* runningServer(home);

  if (Option.isSome(other)) {
    return yield* ServerRunning.make({ home, server: other.value.url });
  }

  const first = yield* rebuild(home, "serve");

  yield* printNotes(first);

  const held = yield* SubscriptionRef.make<Held>({
    good: first.state,
    proposals: first.proposals,
    rejected: Option.none(),
  });

  const watching = yield* Latch.make();

  const onChange = rebuildHeld(home).pipe(
    Effect.flatMap((next) => SubscriptionRef.update(held, next)),
    Effect.catchCause((cause) =>
      Console.error(`serve could not rebuild the map: ${Cause.pretty(cause)}`)
    )
  );

  yield* watchMap(home, watching).pipe(
    Stream.runForEach(() => onChange),
    Effect.catchCause((cause) =>
      Console.error(
        `serve stopped watching ${home}: ${Cause.pretty(cause)} Restart serve to pick up changes again.`
      )
    ),
    Effect.forkIn(scope)
  );

  yield* watching.await;

  const proxied = new Set(Arr.map(options.allowHosts, hostName));

  const allowed = new Set([
    ...loopbackHosts,
    ...proxied,
    ...(wildcardHosts.has(host) ? [] : [hostName(urlHost(host))]),
  ]);

  const stopping = yield* Latch.make();

  const app = yield* HttpRouter.toHttpEffect(
    routes({ home, held, stopping, allowed, proxied })
  );

  const urlHostName = wildcardHosts.has(host) ? defaultHost : urlHost(host);

  // The lock keeps two servers starting at once from both getting past the
  // check above.
  const state = yield* Effect.gen(function* () {
    yield* withLock(home, "serve");

    const raced = yield* runningServer(home);

    if (Option.isSome(raced)) {
      return yield* ServerRunning.make({ home, server: raced.value.url });
    }

    const server = yield* listen(host, options.port).pipe(Scope.provide(scope));

    yield* HttpServer.serveEffect()(app).pipe(
      Effect.provideService(HttpServer.HttpServer, server),
      Scope.provide(scope)
    );

    // Finalizers run last first, so open event streams end before the
    // server waits for its connections to close.
    yield* Scope.addFinalizer(scope, stopping.open);

    const recorded: ServerState = {
      url: `http://${urlHostName}:${portOf(server)}`,
      pid: process.pid,
      since: DateTime.formatIso(yield* DateTime.now),
    };

    yield* recordServer(home, recorded).pipe(Scope.provide(scope));

    return recorded;
  }).pipe(Effect.scoped);

  const bound = hostName(urlHost(host));

  if (!Arr.some(loopbackHosts, (name) => name === bound)) {
    yield* Console.error(
      `serve is listening on ${host}, so other machines on the network can reach it. It still only answers requests addressed to ${loopbackList}${wildcardHosts.has(host) ? "" : `, ${host}`} or a host given with --allow-host.`
    );
  }

  yield* Console.log(`Serving ${home} at ${state.url}. Press Ctrl-C to stop.`);

  if (options.open) {
    yield* openBrowser(state.url).pipe(Effect.forkIn(scope));
  }

  return yield* Effect.never;
}, Effect.scoped);
