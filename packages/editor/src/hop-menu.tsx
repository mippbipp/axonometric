import { flowsOfHop, marked, removedHopMark } from "@axonometric/contracts";
import type { Hop } from "@axonometric/contracts";
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
  createMenuController,
} from "@axonometric/ui/components/menu";
import { Array as Arr, Option } from "effect";
import { useMemo, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { useContextMenu } from "./open-context-menu.ts";
import { useSelection } from "./selection-context.ts";
import { useHopFlowToggle } from "./use-hop-flow-toggle.ts";

const idOfSegment = (target: Element) =>
  target.closest<SVGElement>("[data-route-segment]")?.dataset.hopId;

/**
 * The context menu on a hop: a right-click on one of its segments opens a
 * menu to relabel it, delete it, or pick the flows it is in, one or more. It
 * works in both views and every chapter, because a hop's segment carries its
 * id and the menu listens for the right-click on the whole page.
 *
 * The menu opens at the pointer, or at the focused segment for Shift+F10 and
 * the context-menu key, which the browser reports as the same event. The hop
 * is selected too, so its panel shows the same actions and the result of the
 * proposal.
 */
export function HopMenu() {
  const connections = useConnections();
  const { selectHop } = useSelection();
  const menu = useMemo(() => createMenuController(), []);
  const [opened, setOpened] = useState<string | null>(null);
  const [handOffFocus, setHandOffFocus] = useState(false);

  const canPropose = connections?.canPropose === true;

  useContextMenu({
    enabled: canPropose,
    idOf: idOfSegment,
    menu,
    onOpen: (id) => {
      selectHop(id);
      setOpened(id);
    },
  });

  const hop =
    opened === null || connections === null
      ? undefined
      : Arr.findFirst(
          connections.proposed.state.data.hops,
          ({ id }) => id === opened
        ).pipe(Option.getOrUndefined);

  return (
    <Menu
      controller={menu}
      onOpenChange={(open) => {
        if (open) {
          setHandOffFocus(false);
        } else {
          setOpened(null);
        }
      }}
    >
      <MenuContent
        aria-label={hop?.label}
        data-hop-menu={hop?.id}
        finalFocus={handOffFocus ? "none" : "trigger"}
      >
        {hop === undefined ? null : (
          <HopMenuItems
            handOffFocus={() => {
              setHandOffFocus(true);
            }}
            hop={hop}
            key={hop.id}
          />
        )}
      </MenuContent>
    </Menu>
  );
}

/** The entries for one hop, rendered while the menu is open on it. */
function HopMenuItems({
  handOffFocus,
  hop,
}: {
  readonly handOffFocus: () => void;
  readonly hop: Hop;
}) {
  const connections = useConnections();
  const { failure: flowFailure, toggle } = useHopFlowToggle(hop.id);
  const [failure, setFailure] = useState<string | undefined>();

  if (connections === null) {
    return null;
  }

  const { flows } = connections.proposed.state.data;
  const inFlows = flowsOfHop(connections.proposed.state.data, hop.id);
  const deleted = marked(connections.proposed, removedHopMark).has(hop.id);

  return (
    <>
      <MenuLabel>{hop.label}</MenuLabel>
      <MenuItem
        data-menu="relabel"
        disabled={deleted}
        onSelect={() => {
          // The panel is open for the selected hop; its label field takes
          // the focus, so the menu doesn't give it back to the trigger.
          handOffFocus();
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
                checked={inFlows.includes(id)}
                data-menu-flow={id}
                key={id}
                onCheckedChange={(wanted) => {
                  toggle(id, wanted);
                }}
                value={id}
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
        onSelect={() => {
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
      {(failure ?? flowFailure) === undefined ? null : (
        <p
          className="border-refused max-w-56 border-l-2 px-2 py-1"
          data-menu-failure
          role="alert"
        >
          {failure ?? flowFailure}
        </p>
      )}
    </>
  );
}
