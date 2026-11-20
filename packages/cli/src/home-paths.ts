import { historyFolder, revisionFileName } from "@axonometric/contracts";
import type { MapFile } from "@axonometric/contracts";
import { Array as Arr, Effect, Path, String as Str } from "effect";

/** The names of the map's own files in the home folder, as problems name them. */
export const mapFileNames = {
  data: "data.mjs",
  layout: "layout.json",
  proposals: "proposals.json",
} as const satisfies Record<string, MapFile>;

/** The folder in the home folder that holds the state of one running process. */
export const stateFolderName = ".axonometric";

/**
 * Every path in a map's home folder, and in the output folder beside it,
 * built once from the home folder's path. CLI modules and tests take their
 * paths from here, so a file's name is spelled in one place.
 */
export interface HomePaths {
  /** The map's data, `data.mjs`. */
  readonly dataFile: string;
  /** Holds `.gitignore`, which keeps the whole state folder out of git. */
  readonly gitignoreFile: string;
  /** The folder `history/`, which holds one file per revision. */
  readonly historyFolder: string;
  /** The home folder, as given. */
  readonly home: string;
  /** What SYSTEM.md links the home folder as, such as `map`. */
  readonly homeFromOutput: string;
  /** The saved layout, `layout.json`. */
  readonly layoutFile: string;
  /** The lock that every command holds while it reads and writes the map. */
  readonly lockFile: string;
  /** The folder SYSTEM.md and the read-only page are written to. */
  readonly output: string;
  /** The read-only page, `<system>.html`. */
  readonly pageFile: string;
  /** Pending changes, `proposals.json`. */
  readonly proposalsFile: string;
  /** The file of revision `n`. */
  readonly revisionFile: (n: number) => string;
  /** Where `serve` records its URL and process. */
  readonly serverStateFile: string;
  /** `.axonometric/`, the state of one running process. */
  readonly stateFolder: string;
  /** The system's name: the name of the output folder. */
  readonly system: string;
  readonly systemMdFile: string;
}

/** The parts of `Path.Path` that building the paths needs. */
export type PathParts = Pick<
  Path.Path,
  "basename" | "dirname" | "join" | "relative" | "sep"
>;

// oxlint-disable effecttsgo/missing-pipeable-signature -- callers pass a path object and a home folder together, and nothing pipes a home folder into a path object.
/**
 * The paths of the map whose home folder is `home`, joined the way `path`
 * joins them. Tests pass `node:path`'s `posix` to get the `/`-separated names
 * that the files of a home folder are listed by.
 */
export const makeHomePaths = (path: PathParts, home: string): HomePaths => {
  const output = path.dirname(home);
  const system = path.basename(output);
  const stateFolder = path.join(home, stateFolderName);
  const history = path.join(home, historyFolder);

  return {
    dataFile: path.join(home, mapFileNames.data),
    gitignoreFile: path.join(stateFolder, ".gitignore"),
    historyFolder: history,
    home,
    homeFromOutput: path.relative(output, home),
    layoutFile: path.join(home, mapFileNames.layout),
    lockFile: path.join(stateFolder, "lock"),
    output,
    pageFile: path.join(output, `${system}.html`),
    proposalsFile: path.join(home, mapFileNames.proposals),
    revisionFile: (n) => path.join(history, revisionFileName(n)),
    serverStateFile: path.join(stateFolder, "server.json"),
    stateFolder,
    system,
    systemMdFile: path.join(output, "SYSTEM.md"),
  };
};
// oxlint-enable effecttsgo/missing-pipeable-signature

/** The paths of the map whose home folder is `home`. */
export const homePaths = (home: string) =>
  Path.Path.use((path) => Effect.succeed(makeHomePaths(path, home)));

// oxlint-disable effecttsgo/missing-pipeable-signature -- callers have the path object and the file in hand, and nothing pipes a file name into a path object.
/**
 * `file` with `/` between its parts on every platform. Reports and tests
 * name files this way, so one name holds on Windows too.
 */
export const posixPath = (path: Pick<Path.Path, "sep">, file: string) =>
  Arr.join(Str.split(file, path.sep), "/");
// oxlint-enable effecttsgo/missing-pipeable-signature
