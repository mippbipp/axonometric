import { flowsOfHop, marked, removedHopMark } from "@axonometric/contracts";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "@axonometric/ui/components/menu";
import { Array as Arr, Option } from "effect";
import { useEffect, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { useSelection } from "./selection-context.ts";

/** Where the menu opened: a point on the page, and the hop under it. */
interface Opened {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The context menu on a hop: a right-click on one of its segments opens a
 * menu to relabel it, delete it, or pick the flows it is in, one or more. It
 * works in both views and every chapter, because a hop's segment carries its
 * id and the menu listens for the right-click on the whole page.
 *
 * The hop is selected too, so its panel shows the same actions and the
 * result of the proposal.
 */
export function HopMenu() {
  const connections = useConnections();
  const { selectHop } = useSelection();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failure, setFailure] = useState<string | undefined>();

  const canPropose = connections?.canPropose === true;

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!canPropose) {
        return;
      }

      const id =
        event.target instanceof Element
          ? event.target.closest<SVGElement>("[data-route-segment]")?.dataset
              .hopId
          : undefined;

      if (id === undefined) {
        return;
      }

      event.preventDefault();
      selectHop(id);
      setFailure(undefined);
      setOpened({ id, x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canPropose, selectHop]);

  const hop =
    opened === null || connections === null
      ? undefined
      : Arr.findFirst(
          connections.proposed.state.data.hops,
          ({ id }) => id === opened.id
        ).pipe(Option.getOrUndefined);

  if (opened === null || hop === undefined || connections === null) {
    return null;
  }

  const { flows } = connections.proposed.state.data;
  const inFlows = flowsOfHop(connections.proposed.state.data, hop.id);
  const deleted = marked(connections.proposed, removedHopMark).has(hop.id);

  const anchor = {
    getBoundingClientRect: () => new DOMRect(opened.x, opened.y, 0, 0),
  };

  const toggle = (flowId: string, wanted: boolean) => {
    const flow = Arr.findFirst(flows, ({ id }) => id === flowId);

    if (Option.isNone(flow)) {
      return;
    }

    const without = Arr.filter(flow.value.hops, (other) => other !== hop.id);
    const next = wanted ? [...without, hop.id] : without;

    if (!Arr.isReadonlyArrayNonEmpty(next)) {
      setFailure(
        `"${flow.value.name}" would be left with no hops. A flow lists at least one.`
      );

      return;
    }

    const change = { action: "hops" as const, flow: flowId, hops: next };
    const refusal = connections.refusalOfFlow(change);

    if (refusal !== undefined) {
      setFailure(refusal);

      return;
    }

    connections.proposeFlow(change, () => {});
  };

  return (
    <Menu
      open
      onOpenChange={(open) => {
        if (!open) {
          setOpened(null);
        }
      }}
    >
      <MenuContent anchor={anchor} data-hop-menu={hop.id}>
        <MenuLabel>{hop.label}</MenuLabel>
        <MenuItem
          data-menu="relabel"
          disabled={deleted}
          onClick={() => {
            // The panel is open for the selected hop; its label field takes
            // the typing.
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLInputElement>(
                  "[data-hop-panel] [data-hop-label-field]"
                )
                ?.select();
            });
          }}
        >
          Relabel…
        </MenuItem>
        {flows.length === 0 ? null : (
          <MenuSub>
            <MenuSubTrigger data-menu="flows" disabled={deleted}>
              Flows
            </MenuSubTrigger>
            <MenuSubContent>
              {Arr.map(flows, ({ id, name }) => (
                <MenuCheckboxItem
                  key={id}
                  data-menu-flow={id}
                  checked={inFlows.includes(id)}
                  onCheckedChange={(wanted) => {
                    toggle(id, wanted);
                  }}
                >
                  {name}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        )}
        <MenuSeparator />
        <MenuItem
          data-menu="delete-hop"
          disabled={deleted}
          onClick={() => {
            const change = { action: "delete" as const, hop: hop.id };
            const refusal = connections.refusalOfHop(change);

            if (refusal !== undefined) {
              setFailure(refusal);

              return;
            }

            connections.proposeHop(change, () => {});
          }}
        >
          Propose deleting
        </MenuItem>
        {failure === undefined ? null : (
          <p
            role="alert"
            data-menu-failure
            className="border-refused max-w-56 border-l-2 px-2 py-1"
          >
            {failure}
          </p>
        )}
      </MenuContent>
    </Menu>
  );
}
