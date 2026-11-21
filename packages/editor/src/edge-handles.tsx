import {
  handleRadius,
  handleStroke,
  hopPortAt,
  hopPortsOf,
} from "@axonometric/contracts";
import type { View } from "@axonometric/contracts";
import {
  ConnectPort,
  ConnectPorts,
} from "@axonometric/ui/components/connect-ports";
import type {
  ConnectDraft,
  ConnectMessage,
} from "@axonometric/ui/components/connect-ports";
import { use, useMemo, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { EditorSceneContext, EditorViewContext } from "./editor-view.ts";
import { groundAt } from "./ground-at.ts";
import { drawHopKey, useHopDraft } from "./hop-draft-context.ts";
import type { HopStretch } from "./hop-draft-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { HoveredIdContext } from "./tooltip-context.ts";

/** Each port's own classes: the owner's handles show, the rest only as a target. */
const handleClass =
  "fill-paper stroke-pending cursor-crosshair data-[connect=target]:fill-pending";
const hiddenPortClass =
  "fill-paper stroke-pending pointer-events-none opacity-0 data-[connect=target]:fill-pending data-[connect=target]:opacity-100";

/**
 * Small handles on the edges of the selected or hovered structure, while the
 * page can propose, in both views. Dragging one onto another structure draws
 * a line (see `HopDraftLine`) and, on the drop, opens the label field in the
 * side panel for that structure, wherever on its footprint the drop is.
 * Dropping on empty space, or pressing Escape, draws nothing. With a
 * structure focused, `h` starts the same line from it, the arrows pick the
 * port it goes to, and Enter opens the label field; each step is announced.
 *
 * Every revealed structure has its ports here, unseen until the line aims at
 * one, so the arrows have somewhere to go. This is an editing layer: it keeps
 * each handle at least `gapAt(zoom)` clear of every name tag, code chip and
 * hop label, and a file's drawing never includes it. The handles are drawn
 * over the structures, since they sit on their edges; the line the drag draws
 * is under the text.
 */
export function EdgeHandles({ view }: { readonly view: View }) {
  const editor = use(EditorViewContext);
  const scene = use(EditorSceneContext);
  const connections = useConnections();
  const drafting = useHopDraft();
  const { selected } = useSelection();
  const hovered = use(HoveredIdContext);
  const byId = useStructuresById();
  const live = connections?.canPropose === true && drafting !== null;
  const stretch = drafting?.stretch ?? null;
  const revealed = editor?.revealed;

  // A pinned structure keeps its handles; else the one under the pointer.
  // Moving from a structure onto one of its handles leaves the structure a
  // moment before it enters the handle, so a handle entered keeps its
  // structure as `near` until the pointer leaves the handle.
  const [near, setNear] = useState<string | null>(null);
  const owner = stretch?.from ?? selected ?? hovered ?? near;

  const ports = useMemo(
    () =>
      scene === null || revealed === undefined
        ? []
        : hopPortsOf({ revealed, scene }),
    [scene, revealed]
  );

  const byKey = useMemo(
    () => new Map(ports.map((port) => [port.key, port])),
    [ports]
  );

  if (editor === null || scene === null || !live) {
    return <g data-edge-handles="off" />;
  }

  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const ownerOf = (key: string) => byKey.get(key)?.owner ?? key;

  const label = (key: string) => {
    const port = byKey.get(key);

    if (port === undefined) {
      return key;
    }

    return port.side === "centre"
      ? nameOf(port.owner)
      : `${nameOf(port.owner)}, ${port.side} edge`;
  };

  // A drop opens the label form rather than making the hop, so the last
  // step says what comes next.
  const message = (said: ConnectMessage) => {
    if (said.type === "start") {
      return `Drawing a hop from ${nameOf(ownerOf(said.from))}. Arrows pick where it goes, Enter names it, Escape cancels.`;
    }

    if (said.type === "target") {
      return `To ${label(said.to)}.`;
    }

    return said.type === "connect"
      ? `Hop from ${nameOf(ownerOf(said.from))} to ${nameOf(ownerOf(said.to))}. Name it to propose it.`
      : "Hop canceled.";
  };

  const stretchOf = (draft: ConnectDraft | null): HopStretch | null => {
    const start = draft === null ? undefined : byKey.get(draft.from);

    return draft === null || start === undefined
      ? null
      : {
          end: { x: draft.x, y: draft.y },
          from: start.owner,
          over: draft.to === null ? null : ownerOf(draft.to),
          start: start.at,
        };
  };

  const firstPortOf = (id: string | undefined) =>
    ports.find((port) => port.owner === id)?.key ?? null;

  return (
    <ConnectPorts
      canConnect={(from, to) => {
        const target = ownerOf(to);

        return ownerOf(from) !== target && editor.revealed.has(target);
      }}
      data-edge-handles={owner ?? "off"}
      label={label}
      message={message}
      onConnect={(from, to) => {
        drafting.begin(ownerOf(from), ownerOf(to));

        return true;
      }}
      onDraft={(draft) => {
        drafting.stretchTo(stretchOf(draft));
      }}
      point={(element, at) =>
        element instanceof SVGGraphicsElement
          ? groundAt({ element, event: at, view })
          : undefined
      }
      sourceOf={(target) =>
        firstPortOf(
          target.closest<SVGElement>("[data-structure]")?.dataset.structure
        )
      }
      startKey={drawHopKey}
      targetAt={(point, from) =>
        hopPortAt({
          except: ownerOf(from),
          placements: editor.placements,
          point,
          ports,
          revealed: editor.revealed,
          view,
        })?.key ?? null
      }
    >
      {ports.map((port) =>
        port.owner === owner && port.side !== "centre" ? (
          <ConnectPort
            className={handleClass}
            cx={port.at.sx}
            cy={port.at.sy}
            data-edge-handle={port.side}
            data-edge-owner={owner}
            key={port.key}
            onPointerEnter={() => {
              setNear(owner);
            }}
            onPointerLeave={() => {
              setNear(null);
            }}
            r={handleRadius}
            strokeWidth={handleStroke}
            value={port.key}
          />
        ) : (
          <ConnectPort
            className={hiddenPortClass}
            cx={port.at.sx}
            cy={port.at.sy}
            key={port.key}
            r={handleRadius}
            strokeWidth={handleStroke}
            value={port.key}
          />
        )
      )}
    </ConnectPorts>
  );
}
