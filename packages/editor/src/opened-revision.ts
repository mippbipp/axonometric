import type { Revision } from "@axonometric/contracts";
import { Effect } from "effect";
import { useCallback, useState } from "react";

import type { LoadedRevision } from "./history-client.ts";

/** The revision the engineer chose in the History tab, and how far reading it got. */
export type Opened =
  | { readonly revision: number; readonly status: "loading" }
  | {
      readonly revision: number;
      readonly status: "failed";
      readonly message: string;
    }
  | {
      readonly revision: number;
      readonly status: "ready";
      readonly saved: Revision;
    };

/**
 * Which past revision the page is showing. Choosing one reads it from the
 * server; the page keeps showing the current map until the read is done, and
 * a read that comes back after another choice is dropped.
 */
export const useOpenedRevision = (
  read: (n: number) => Effect.Effect<LoadedRevision>
) => {
  const [opened, setOpened] = useState<Opened | null>(null);

  const open = useCallback(
    (revision: number) => {
      setOpened({ revision, status: "loading" });

      Effect.runFork(
        read(revision).pipe(
          Effect.tap((loaded) =>
            Effect.sync(() => {
              setOpened((now) => {
                if (now?.revision !== revision) {
                  return now;
                }

                return loaded.ok
                  ? { revision, status: "ready", saved: loaded.revision }
                  : { revision, status: "failed", message: loaded.message };
              });
            })
          )
        )
      );
    },
    [read]
  );

  const close = useCallback(() => {
    setOpened(null);
  }, []);

  return { opened, open, close };
};
