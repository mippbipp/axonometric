import { MapState, ServerState } from "@axonometric/contracts";
import {
  NodeHttpClient,
  NodeServices,
  NodeSocket,
} from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Schedule,
  Schema,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { crowdedMap, minimalMap } from "./fixtures.ts";
import {
  makeHome,
  runCli,
  startServe,
  mapKeys,
  homeKeys,
  mapIn,
} from "./harness.ts";

/** A home folder holding the minimal map, and its path. */
const minimalHome = Effect.gen(function* () {
  const minimalMapFiles = yield* minimalMap;
  const root = yield* makeHome(minimalMapFiles);

  return mapIn(root, "pipeline").home;
}).pipe(Effect.provide(NodeServices.layer));

const encodeServerState = Schema.encodeEffect(
  Schema.fromJsonString(ServerState)
);

/** A home with the minimal map and a state file naming `pid`, as a running `serve` would write it. */
const homeWithStateFile = Effect.fnUntraced(function* (pid: number) {
  const root = yield* makeHome({
    ...(yield* minimalMap),
    [mapKeys("pipeline").serverStateFile]: yield* encodeServerState({
      pid,
      since: "2026-11-01T09:00:00.000Z",
      url: "http://127.0.0.1:5999",
    }),
  });

  return mapIn(root, "pipeline").home;
}, Effect.provide(NodeServices.layer));

/** The PID of a child process that idles until the scope closes. */
const liveProcess = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"])
  );

  return Number(handle.pid);
}).pipe(Effect.provide(NodeServices.layer));

/**
 * A PID no process has or will have. A real process's PID won't do: Windows
 * hands a freed PID to the next process it starts, so the "dead" process
 * could be running again, as one of the other test files' processes, by the
 * time `serve` checks. Node reports a PID that can't exist as missing, the
 * same as one that has exited.
 */
const deadPid = Effect.succeed(2 ** 31 - 1);

/**
 * Sends a GET for `pathname` to the server at `url` with the Host header set
 * to `host`, which `fetch` doesn't allow. Returns the status.
 */
const getWithHost = (url: string, pathname: string, host: string) =>
  HttpClient.HttpClient.use((client) =>
    client.execute(
      HttpClientRequest.get(new URL(pathname, url)).pipe(
        HttpClientRequest.setHeader("host", host)
      )
    )
  ).pipe(
    Effect.map((response) => response.status),
    Effect.scoped,
    Effect.provide(NodeHttpClient.layerNodeHttp)
  );

/**
 * Sends a GET for `/api/state` with no Host header at all, which no HTTP
 * client allows, over a raw socket. Returns the status from the reply's
 * first line.
 */
const getWithoutHost = (url: string) =>
  Effect.gen(function* () {
    const target = new URL(url);

    const socket = yield* NodeSocket.makeNet({
      host: target.hostname,
      port: Number(target.port),
    });

    const writer = yield* socket.writer;
    const reader = yield* socket.reader;

    yield* writer.write("GET /api/state HTTP/1.0\r\nConnection: close\r\n\r\n");

    const [first] = yield* reader.pull;

    const text =
      first === undefined || Predicate.isString(first)
        ? (first ?? "")
        : new TextDecoder().decode(first);

    const [, status = ""] = Str.split(" ")(text);

    return Number(status);
  }).pipe(Effect.scoped);

const decodeServed = Schema.decodeUnknownEffect(
  Schema.fromJsonString(MapState)
);

const hasName = (name: string) => (structure: { readonly name: string }) =>
  structure.name === name;

const portOf = (url: string) => Number(new URL(url).port);

const running = Schema.Literal(true);

const stopped = Schema.Literal(false);

const StatusReport = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ home: Schema.String, running, ...ServerState.fields }),
    Schema.Struct({ home: Schema.String, running: stopped }),
  ])
);

const decodeReport = Schema.decodeUnknownEffect(StatusReport);

describe("status", () => {
  it.live("says no server is running when there's no state file", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;

      const result = yield* runCli(home, ["status", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.strictEqual(
        result.stdout,
        `No server is running for ${home}. Start one with axonometric serve.\n`
      );
    })
  );

  it.live("prints the URL, PID and page count of a live server", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const serve = yield* startServe(home, ["--port", "0"]);

      const text = yield* runCli(home, ["status", home]);
      const json = yield* runCli(home, ["status", home, "--json"]);

      assert.strictEqual(text.exitCode, 0, text.stderr);
      assert.include(
        text.stdout,
        `Serving ${home} at ${serve.url}, process ${process.pid}, since `
      );
      assert.include(text.stdout, ", 0 pages connected.\n");
      const report = yield* decodeReport(json.stdout);
      assert.include(report, {
        home,
        pid: process.pid,
        running: true,
        url: serve.url,
      });
    })
  );

  it.live(
    "fails, rather than saying none runs, when a live process doesn't answer",
    () =>
      Effect.gen(function* () {
        const pid = yield* liveProcess;
        const home = yield* homeWithStateFile(pid);

        const text = yield* runCli(home, ["status", home]);
        const json = yield* runCli(home, ["status", home, "--json"]);

        for (const result of [text, json]) {
          assert.notStrictEqual(result.exitCode, 0);
          assert.include(result.stderr, "http://127.0.0.1:5999");
          assert.include(result.stderr, `process ${pid}`);
          assert.include(result.stderr, "didn't answer");
          assert.notInclude(result.stdout, "No server is running");
        }
      })
  );

  it.live("ignores a state file whose process has exited", () =>
    Effect.gen(function* () {
      const stalePid = yield* deadPid;
      const home = yield* homeWithStateFile(stalePid);

      const text = yield* runCli(home, ["status", home]);
      const json = yield* runCli(home, ["status", home, "--json"]);

      assert.strictEqual(
        text.stdout,
        `No server is running for ${home}. Start one with axonometric serve.\n`
      );
      const report = yield* decodeReport(json.stdout);
      assert.deepStrictEqual(report, {
        home,
        running: false,
      });
    })
  );
});

describe("serve", () => {
  it.live(
    "prints its URL, records it for status, and removes the record when stopped",
    () =>
      Effect.gen(function* () {
        const home = yield* minimalHome;

        const serve = yield* startServe(home, ["--port", "0"]);
        const status = yield* runCli(home, ["status", home, "--json"]);

        assert.match(serve.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
        assert.include(serve.output.stdout, serve.url);
        const report = yield* decodeReport(status.stdout);
        assert.include(report, {
          home,
          pid: process.pid,
          running: true,
          url: serve.url,
        });

        assert.isDefined(status.files[homeKeys.serverStateFile]);

        yield* serve.stop;

        const after = yield* runCli(home, ["status", home]);

        assert.isUndefined(after.files[homeKeys.serverStateFile]);
      })
  );

  it.live(
    "leaves out the drawing warning check prints, at start and on a rebuild",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const crowded = yield* crowdedMap;
        const root = yield* makeHome(crowded);
        const { dataFile, home } = mapIn(root, "crowded");
        const serve = yield* startServe(home, ["--port", "0"]);
        const text = yield* fs.readFileString(dataFile);
        const renamed = Str.replace('name: "Client"', 'name: "Customer"')(text);

        assert.notStrictEqual(renamed, text);
        yield* fs.writeFileString(dataFile, renamed);

        const served = HttpClient.HttpClient.use((client) =>
          client.get(new URL("/api/state", serve.url))
        ).pipe(
          Effect.flatMap((response) => response.text),
          Effect.flatMap(decodeServed),
          Effect.scoped,
          Effect.provide(NodeHttpClient.layerNodeHttp)
        );

        yield* served.pipe(
          Effect.filterOrFail(
            ({ data }) => Arr.some(data.structures, hasName("Customer")),
            () => "serve has not rebuilt yet"
          ),
          Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
          Effect.orDie
        );

        const checked = yield* runCli(root, ["check", home]);

        assert.include(checked.stdout, 'hop "h-secret" from "api" to "vault"');
        assert.notInclude(
          serve.output.stdout + serve.output.stderr,
          "h-secret"
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live("refuses to start while another serve runs on the map", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const first = yield* startServe(home, ["--port", "0"]);

      const second = yield* runCli(home, ["serve", home, "--port", "0"]);

      assert.strictEqual(second.exitCode, 1);
      assert.include(
        second.stderr,
        `A server is already running for ${home} at ${first.url}`
      );
    })
  );

  it.live("starts over a state file left by a dead process", () =>
    Effect.gen(function* () {
      const stalePid = yield* deadPid;
      const home = yield* homeWithStateFile(stalePid);

      yield* startServe(home, ["--port", "0"]);
      const status = yield* runCli(home, ["status", home, "--json"]);
      const report = yield* decodeReport(status.stdout);

      assert.include(report, { pid: process.pid, running: true });
    })
  );

  it.live("fails when the port given with --port is busy", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const servedHome = yield* minimalHome;
      const other = yield* startServe(servedHome, ["--port", "0"]);
      const port = portOf(other.url);

      const result = yield* runCli(home, ["serve", home, "--port", `${port}`]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        `Port ${port} on 127.0.0.1 is in use. Pick another with --port, or leave --port out to use the next free port.`
      );
      assert.isUndefined(result.files[homeKeys.serverStateFile]);
    })
  );

  it.live("uses port 5178, or the next free port when it's busy", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const firstHome = yield* minimalHome;
      const first = yield* startServe(firstHome, []);
      const second = yield* startServe(home, []);
      const firstPort = portOf(first.url);
      const secondPort = portOf(second.url);

      // Something else on this machine may hold 5178, and the ports after
      // it. Each port serve passed over must be in use: asking for it fails,
      // where a serve that started on it would mean it was free.
      for (let port = 5178; port < firstPort; port++) {
        const probe = yield* minimalHome;

        const asked = yield* runCli(probe, [
          "serve",
          probe,
          "--port",
          `${port}`,
        ]).pipe(Effect.timeoutOption("5 seconds"));

        assert.include(
          Option.getOrUndefined(asked)?.stderr ?? "it started",
          `Port ${port} on 127.0.0.1 is in use`,
          `serve took ${firstPort} while ${port} was free`
        );
      }

      assert.isAtLeast(firstPort, 5178);
      assert.isAbove(secondPort, firstPort);
      assert.isBelow(secondPort, 5178 + 20);
    })
  );

  it.live("answers 403 to a forged Host, and 200 to an allowed one", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;

      const serve = yield* startServe(home, [
        "--port",
        "0",
        "--allow-host",
        "map.example.test",
        "--allow-host",
        "other.example.test",
      ]);

      const port = portOf(serve.url);

      const statuses = yield* Effect.forEach(
        [
          `localhost:${port}`,
          `LOCALHOST:${port}`,
          `127.0.0.1:${port}`,
          `[::1]:${port}`,
          "map.example.test",
          `other.example.test:${port}`,
          "attacker.example.test",
          `attacker.example.test:${port}`,
          `localhost.attacker.example.test:${port}`,
        ],
        (host) => getWithHost(serve.url, "/api/state", host),
        { concurrency: 1 }
      );

      assert.deepStrictEqual(
        statuses,
        [200, 200, 200, 200, 200, 200, 403, 403, 403]
      );

      const statusWithHost = yield* getWithHost(
        serve.url,
        "/",
        "attacker.example.test"
      );

      assert.strictEqual(statusWithHost, 403);
      const statusWithoutHost = yield* getWithoutHost(serve.url);
      assert.strictEqual(statusWithoutHost, 403);
    })
  );

  it.live("warns when --host binds an address other machines can reach", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;

      const serve = yield* startServe(home, [
        "--port",
        "0",
        "--host",
        "0.0.0.0",
      ]);

      assert.include(
        serve.output.stderr,
        "serve is listening on 0.0.0.0, so other machines on the network can reach it."
      );
    })
  );
});
