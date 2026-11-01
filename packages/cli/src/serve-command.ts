import { ServerState } from "@axonometric/contracts";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

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
        "Listen on this port, and fail if it's busy. Without it, serve uses 5178 or the next free port."
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
  }),
  Schema.Struct({ home: Schema.String, running: Schema.Literal(false) }),
]);

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(StatusReport));

const status = Effect.fn("status")(function* (home: string, json: boolean) {
  const server = yield* runningServer(home);

  const report = Option.match(server, {
    onNone: () => ({ home, running: false as const }),
    onSome: (state) => ({ home, running: true as const, ...state }),
  });

  const text = Option.match(server, {
    onNone: () =>
      `No server is running for ${home}. Start one with axonometric serve.`,
    onSome: ({ url, pid, since }) =>
      `Serving ${home} at ${url}, process ${pid}, since ${since}.`,
  });

  yield* Console.log(json ? yield* encodeReport(report) : text);
});

export const statusCommand = Command.make(
  "status",
  {
    home: homeArgument,
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print { home, running, url, pid, since } as JSON instead of text"
      )
    ),
  },
  ({ home, json }) => status(home, json)
).pipe(
  Command.withDescription(
    "Print the URL and process ID of the server running for the map, if any"
  )
);
