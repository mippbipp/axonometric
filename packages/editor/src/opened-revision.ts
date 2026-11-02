import type { Revision } from "@axonometric/contracts";
import { Effect, Fiber } from "effect";
import type { Fiber as FiberType } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";

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
 * server, and the page keeps showing the current map until the read is done.
 * Choosing another revision, going back, or leaving the page interrupts the
 * read still under way, so a late answer can't land on the wrong revision.
 */
export const useOpenedRevision = (
  read: (n: number) => Effect.Effect<LoadedRevision>
) => {
  const [opened, setOpened] = useState<Opened | null>(null);
  const reading = useRef<FiberType.Fiber<void> | undefined>(undefined);

  const stop = useCallback(() => {
    const fiber = reading.current;

    reading.current = undefined;

    if (fiber !== undefined) {
      Effect.runFork(Fiber.interrupt(fiber));
    }
  }, []);

  const open = useCallback(
    (revision: number) => {
      stop();
      setOpened({ revision, status: "loading" });

      reading.current = Effect.runFork(
        read(revision).pipe(
          Effect.tap((loaded) =>
            Effect.sync(() => {
              setOpened(
                loaded.ok
                  ? { revision, status: "ready", saved: loaded.revision }
                  : { revision, status: "failed", message: loaded.message }
              );
            })
          ),
          Effect.asVoid
        )
      );
    },
    [read, stop]
  );

  const close = useCallback(() => {
    stop();
    setOpened(null);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { opened, open, close };
};
