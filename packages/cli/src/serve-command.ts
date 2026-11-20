/* oxlint-disable perfectionist/sort-objects -- schema and table field order sets encoded JSON key order, message order and listing order, so it stays as written */
import {
  describeCause,
  serverPaths,
  ServerState,
  ServerStatus,
} from "@axonometric/contracts";
import { NodeHttpClient } from "@effect/platform-node";
import { Console, DateTime, Effect, Option, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { homePaths } from "./home-paths.ts";
import { defaultHost, serve } from "./serve.ts";
import { runningServer } from "./server-state.ts";

const homeArgument = Argument.Directory("home", { mustExist: true }).pipe(
  Argument.withDescription(
    "The map's home folder, holding data.mjs and layout.json"
  )
);

export const serveCommand = Command.make(
  "serve",
  {
    home: homeArgument,
    port: Flag.Int("port").pipe(
      Flag.optional,
      Flag.withDescription(
        "Listen on this port, and fail if it's busy. 0 lets the system pick a free port. Without it, serve uses 5178 or the next free port."
      )
    ),
    host: Flag.String("host").pipe(
      Flag.withDefault(defaultHost),
      Flag.withDescription(
        "The address to listen on. Anything but loopback lets other machines connect."
      )
    ),
    allowHosts: Flag.String("allow-host").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "Also answer requests addressed to this host name, such as a reverse proxy's. Repeat it for more names."
      )
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Open the map in the system's browser")
    ),
  },
  ({ home, port, host, allowHosts, open }) =>
    serve({ home, port, host, allowHosts, open })
).pipe(
  Command.withDescription(
    "Serve the map on 127.0.0.1, and rebuild it and update open pages whenever data.mjs or layout.json changes. Runs until Ctrl-C."
  )
);

/** What `status --json` prints. */
const StatusReport = Schema.Union([
  Schema.Struct({
    home: Schema.String,
    running: Schema.Literal(true),
    ...ServerState.fields,
    pages: ServerStatus.fields.pages,
    now: ServerStatus.fields.now,
    decisions: Schema.optionalKey(ServerStatus.fields.decisions),
  }),
  Schema.Struct({ home: Schema.String, running: Schema.Literal(false) }),
]);

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(StatusReport));

/** `status --since` was given something that isn't an ISO date and time. */
export class SinceInvalid extends Schema.TaggedError<
  SinceInvalid,
  { readonly brand: unique symbol }
>()("SinceInvalid", { value: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `--since takes a date and time such as 2026-11-20T09:30:00.000Z, and got "${this.value}". Pass the "now" an earlier status --json printed.`;
  }
}

/** `status --since` was given without `--json`, which is the only output that lists decisions. */
export class SinceNeedsJson extends Schema.TaggedError<
  SinceNeedsJson,
  { readonly brand: unique symbol }
>()("SinceNeedsJson", {}) {
  public override get [CliError.userMessage]() {
    return "--since only works with --json, which is where status lists the decisions. Add --json.";
  }
}

/** The server whose state file is there didn't answer `status`. */
export class ServerNotAnswering extends Schema.TaggedError<
  ServerNotAnswering,
  { readonly brand: unique symbol }
>()("ServerNotAnswering", {
  pid: Schema.Int,
  reason: Schema.String,
  url: Schema.String,
}) {
  public override get [CliError.userMessage]() {
    return `The server at ${this.url}, process ${this.pid}, is running but didn't answer for its status: ${this.reason}`;
  }
}

/** What a running server says about its pages and decisions. */
const askStatus = Effect.fnUntraced(function* (
  { pid, url }: ServerState,
  since: Option.Option<DateTime.Utc>
) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

  const request = HttpClientRequest.get(new URL(serverPaths.status, url)).pipe(
    HttpClientRequest.setUrlParams(
      Option.match(since, {
        onNone: () => ({}),
        onSome: (at) => ({ since: DateTime.formatIso(at) }),
      })
    )
  );

  return yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(ServerStatus)),
    Effect.mapError((cause) =>
      ServerNotAnswering.make({ pid, reason: describeCause(cause), url })
    )
  );
}, Effect.scoped);

const parseSince = Effect.fnUntraced(function* (
  json: boolean,
  given: Option.Option<string>
) {
  if (Option.isNone(given)) {
    return Option.none<DateTime.Utc>();
  }

  if (!json) {
    return yield* SinceNeedsJson.make({});
  }

  const at = DateTime.make(given.value);

  return Option.isSome(at) && DateTime.isUtc(at.value)
    ? at
    : yield* SinceInvalid.make({ value: given.value });
});

const status = Effect.fn("status")(function* (
  home: string,
  json: boolean,
  sinceFlag: Option.Option<string>
) {
  const since = yield* parseSince(json, sinceFlag);
  const paths = yield* homePaths(home);
  const server = yield* runningServer(paths);

  if (Option.isNone(server)) {
    yield* Console.log(
      json
        ? yield* encodeReport({ home, running: false })
        : `No server is running for ${home}. Start one with axonometric serve.`
    );

    return;
  }

  const state = server.value;
  const { decisions, now, pages } = yield* askStatus(state, since);
  const running = { home, running: true as const, ...state, now, pages };

  const report = yield* encodeReport(
    Option.isSome(since) ? { ...running, decisions } : running
  );

  yield* Console.log(
    json
      ? report
      : `Serving ${home} at ${state.url}, process ${state.pid}, since ${state.since}, ${pages} ${pages === 1 ? "page" : "pages"} connected.`
  );
});

export const statusCommand = Command.make(
  "status",
  {
    home: homeArgument,
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print { home, running, url, pid, since, pages, now } as JSON instead of text"
      )
    ),
    since: Flag.String("since").pipe(
      Flag.optional,
      Flag.withDescription(
        "With --json, also list the engineer's accepts and discards of your changes after this time, such as the now of an earlier status --json"
      )
    ),
  },
  ({ home, json, since }) => status(home, json, since)
).pipe(
  Command.withDescription(
    "Print the URL, process ID and connected page count of the server running for the map, if any"
  ),
  Command.provide(NodeHttpClient.layerNodeHttp)
);
