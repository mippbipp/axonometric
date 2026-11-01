import { Console, Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The command that opens `url` in the system's browser. */
const openCommand = (url: string) => {
  if (process.platform === "darwin") {
    return ChildProcess.make("open", [url]);
  }

  // `start` is built into cmd. Its first quoted argument is a window title,
  // so it gets an empty one.
  return process.platform === "win32"
    ? ChildProcess.make("cmd", ["/c", "start", '""', url], {
        windowsHide: true,
      })
    : ChildProcess.make("xdg-open", [url]);
};

/**
 * Opens `url` in the system's browser. A failure is printed, not raised:
 * the server is already running, and the engineer can open the URL by hand.
 */
export const openBrowser = (url: string) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) =>
    spawner.exitCode(openCommand(url))
  ).pipe(
    Effect.flatMap((code) =>
      Number(code) === 0
        ? Effect.void
        : Effect.fail(`the opener exited with code ${Number(code)}`)
    ),
    Effect.catchCause(() =>
      Console.error(`serve could not open a browser. Open ${url} yourself.`)
    )
  );
