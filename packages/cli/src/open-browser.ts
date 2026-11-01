import { Console, Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The system's opener ran, and exited with a code other than 0. */
class OpenerFailed extends Schema.TaggedError<
  OpenerFailed,
  { readonly brand: unique symbol }
>()("OpenerFailed", { code: Schema.Int }) {}

/**
 * The command that opens `url` in the system's browser. None runs through a
 * shell, so nothing in the URL is parsed as a command. On Windows,
 * `url.dll,FileProtocolHandler` hands the URL to the default browser as it
 * is, where `cmd /c start` would reparse it.
 */
const openCommand = (url: string) => {
  if (process.platform === "darwin") {
    return ChildProcess.make("open", [url]);
  }

  return process.platform === "win32"
    ? ChildProcess.make("rundll32", ["url.dll,FileProtocolHandler", url], {
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
        : Effect.fail(OpenerFailed.make({ code: Number(code) }))
    ),
    Effect.catchCause(() =>
      Console.error(`serve could not open a browser. Open ${url} yourself.`)
    )
  );
