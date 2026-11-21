import { Array as Arr, Result } from "effect";

const keyPrefix = "structure:";

/**
 * Structure `id`'s key among the map's canvas items. Packets, notes and
 * group titles have prefixes of their own, and a structure id may be any
 * text, such as `group:loop`, so a structure's key has one too.
 */
export const structureKey = (id: string) => `${keyPrefix}${id}`;

/** The structure ids among canvas item keys, for the editor's selection. */
export const structureIdsOf = (keys: ReadonlyArray<string>) =>
  Arr.filterMap(keys, (key) =>
    key.startsWith(keyPrefix)
      ? Result.succeed(key.slice(keyPrefix.length))
      : Result.failVoid
  );
