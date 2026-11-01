import { ServerState } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { minimalMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

/** A home folder holding the minimal map, and its path. */
const minimalHome = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* minimalMap);

  return path.join(root, "pipeline", "map");
}).pipe(Effect.provide(NodeServices.layer));

const stateFileOf = (home: string) =>
  Path.Path.use((path) =>
    Effect.succeed(path.join(home, ".axonometric", "server.json"))
  ).pipe(Effect.provide(NodeServices.layer));

const encodeServerState = Schema.encodeEffect(
  Schema.fromJsonString(ServerState)
);

/** A state file as a running `serve` would write it. */
const writeStateFile = Effect.fnUntraced(function* (home: string, pid: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.makeDirectory(path.join(home, ".axonometric"), { recursive: true });
  yield* fs.writeFileString(
    yield* stateFileOf(home),
    yield* encodeServerState({
      url: "http://127.0.0.1:5999",
      pid,
      since: "2026-11-01T09:00:00.000Z",
    })
  );
}, Effect.provide(NodeServices.layer));

/** The PID of a child process that idles until the scope closes. */
const liveProcess = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"])
  );

  return Number(handle.pid);
}).pipe(Effect.provide(NodeServices.layer));

/** The PID of a process that has exited. */
const deadPid = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, ["-e", ""])
  );

  yield* handle.exitCode;

  return Number(handle.pid);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

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

  it.live("prints the URL and PID from a live server's state file", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const pid = yield* liveProcess;

      yield* writeStateFile(home, pid);

      const text = yield* runCli(home, ["status", home]);
      const json = yield* runCli(home, ["status", home, "--json"]);

      assert.strictEqual(text.exitCode, 0, text.stderr);
      assert.strictEqual(
        text.stdout,
        `Serving ${home} at http://127.0.0.1:5999, process ${pid}, since 2026-11-01T09:00:00.000Z.\n`
      );
      assert.deepStrictEqual(yield* decodeReport(json.stdout), {
        home,
        running: true,
        url: "http://127.0.0.1:5999",
        pid,
        since: "2026-11-01T09:00:00.000Z",
      });
    })
  );

  it.live("ignores a state file whose process has exited", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;

      yield* writeStateFile(home, yield* deadPid);

      const text = yield* runCli(home, ["status", home]);
      const json = yield* runCli(home, ["status", home, "--json"]);

      assert.strictEqual(
        text.stdout,
        `No server is running for ${home}. Start one with axonometric serve.\n`
      );
      assert.deepStrictEqual(yield* decodeReport(json.stdout), {
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
        const fs = yield* FileSystem.FileSystem;
        const home = yield* minimalHome;

        const serve = yield* startServe(home, ["--port", "0"]);
        const status = yield* runCli(home, ["status", home, "--json"]);

        assert.match(serve.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
        assert.include(serve.output.stdout, serve.url);
        assert.strictEqual(serve.state.pid, process.pid);
        assert.deepStrictEqual(yield* decodeReport(status.stdout), {
          home,
          running: true,
          ...serve.state,
        });

        yield* serve.stop;

        assert.isFalse(yield* fs.exists(yield* stateFileOf(home)));
      }).pipe(Effect.provide(NodeServices.layer))
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
      const home = yield* minimalHome;

      yield* writeStateFile(home, yield* deadPid);

      const serve = yield* startServe(home, ["--port", "0"]);

      assert.strictEqual(serve.state.pid, process.pid);
    })
  );

  it.live("fails when the port given with --port is busy", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;
      const other = yield* startServe(yield* minimalHome, ["--port", "0"]);
      const port = portOf(other.url);

      const result = yield* runCli(home, ["serve", home, "--port", `${port}`]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        `Port ${port} on 127.0.0.1 is in use. Pick another with --port, or leave --port out to use the next free port.`
      );
      assert.isUndefined(result.files[".axonometric/server.json"]);
    })
  );

  it.live("uses port 5178, or the next free port when it's busy", () =>
    Effect.gen(function* () {
      const home = yield* minimalHome;

      // The first server takes 5178, unless something else on this machine
      // has it, so the second always finds it busy.
      const first = yield* startServe(yield* minimalHome, []);
      const second = yield* startServe(home, []);
      const firstPort = portOf(first.url);
      const secondPort = portOf(second.url);

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
          `127.0.0.1:${port}`,
          `[::1]:${port}`,
          "map.example.test",
          `other.example.test:${port}`,
          "attacker.example.test",
          `attacker.example.test:${port}`,
          `localhost.attacker.example.test:${port}`,
        ],
        (host) => getWithHost(serve.url, "/api/state", host)
      );

      assert.deepStrictEqual(
        statuses,
        [200, 200, 200, 200, 200, 403, 403, 403]
      );
      assert.strictEqual(
        yield* getWithHost(serve.url, "/", "attacker.example.test"),
        403
      );
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
