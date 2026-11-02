import { marked, removedMark } from "@axonometric/contracts";
import type { Structure } from "@axonometric/contracts";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "@axonometric/ui/components/menu";
import { Array as Arr, Option } from "effect";
import { useEffect, useState } from "react";

import { useRevealToggle } from "./chapter-reveal.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useNewGroupForm } from "./new-group-context.ts";
import { useProposed } from "./proposed-context.ts";
import { useSelection } from "./selection-context.ts";
import { changeFor, shapeChoices, statusChoices } from "./structure-actions.ts";
import { useStructuresById } from "./structures.ts";
import { useChapterPropose } from "./use-chapter-propose.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** Where the menu opened: a point on the page, and the structure under it. */
interface Opened {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The context menu on a structure: a right-click on it opens a menu to
 * propose deleting it or changing its name, shape, group or status. It works
 * in both views and every chapter, because the map's structure targets carry
 * their id and the menu listens for the right-click on the whole page.
 *
 * The menu opens at the pointer. The structure is selected too, so its panel
 * shows the same actions and the result of the proposal.
 */
export function StructureMenu() {
  const proposing = useProposed();
  const byId = useStructuresById();
  const { state } = useWalkthrough();
  const { select } = useSelection();
  const { send, failure } = usePropose();
  const chapter = useChapterPropose();
  const newGroup = useNewGroupForm();
  const { multiSelection, setMultiSelection } = useSelection();
  const drafting = useHopDraft();
  const [opened, setOpened] = useState<Opened | null>(null);
  const reveal = useRevealToggle(opened?.id ?? "");

  const canPropose = proposing?.canPropose === true;

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!canPropose) {
        return;
      }

      const id =
        event.target instanceof Element
          ? event.target.closest<SVGElement>("[data-structure]")?.dataset
              .structure
          : undefined;

      if (id === undefined) {
        return;
      }

      event.preventDefault();
      select(id);
      setOpened({ id, x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canPropose, select]);

  const structure: Structure | undefined =
    opened === null ? undefined : byId.get(opened.id);

  if (opened === null || structure === undefined || proposing === null) {
    return null;
  }

  const deleted = marked(proposing.proposed, removedMark).has(structure.id);

  const anchor = {
    getBoundingClientRect: () => new DOMRect(opened.x, opened.y, 0, 0),
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
      <MenuContent anchor={anchor} data-structure-menu={structure.id}>
        <MenuLabel>{structure.name}</MenuLabel>
        <MenuItem
          data-menu="rename"
          disabled={deleted}
          onClick={() => {
            // The panel is open for the selected structure; its name field
            // takes the typing.
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLInputElement>(
                  "[data-structure-panel] [data-change='name']"
                )
                ?.select();
            });
          }}
        >
          Rename…
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger data-menu="shape" disabled={deleted}>
            Change shape
          </MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup
              value={structure.shape}
              onValueChange={(next) => {
                const choice = Option.getOrUndefined(
                  Arr.findFirst(shapeChoices, ({ value }) => value === next)
                );

                if (choice !== undefined) {
                  send(changeFor.shape(structure, choice.value));
                }
              }}
            >
              {Arr.map(shapeChoices, ({ value, label }) => (
                <MenuRadioItem
                  key={value}
                  value={value}
                  data-menu-shape={value}
                >
                  {label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger data-menu="group" disabled={deleted}>
            Change group
          </MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup
              value={structure.group}
              onValueChange={(next: string) => {
                send(changeFor.group(structure, next));
              }}
            >
              {Arr.map(state.data.groups, ({ id, title }) => (
                <MenuRadioItem key={id} value={id} data-menu-group={id}>
                  {title}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger data-menu="status" disabled={deleted}>
            Change status
          </MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup
              value={structure.status}
              onValueChange={(next) => {
                const choice = Option.getOrUndefined(
                  Arr.findFirst(statusChoices, ({ value }) => value === next)
                );

                if (choice !== undefined) {
                  send(changeFor.status(structure, choice.value));
                }
              }}
            >
              {Arr.map(statusChoices, ({ value, label }) => (
                <MenuRadioItem
                  key={value}
                  value={value}
                  data-menu-status={value}
                >
                  {label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        {drafting === null ? null : (
          <MenuItem
            data-menu="draw-hop"
            disabled={deleted}
            onClick={() => {
              drafting.begin(structure.id);
            }}
          >
            Draw hop from here…
          </MenuItem>
        )}
        {reveal === undefined ? null : (
          <MenuItem
            data-menu="chapter-toggle"
            disabled={reveal.unavailable !== undefined}
            onClick={() => {
              chapter.send(reveal.change);
            }}
          >
            {reveal.label}
          </MenuItem>
        )}
        <MenuItem
          data-menu="new-group"
          onClick={() => {
            // The structure joins the multi-selection, so the form's
            // "moves … into it" line names it.
            if (!multiSelection.has(structure.id)) {
              setMultiSelection([...multiSelection, structure.id]);
            }

            newGroup?.setOpen(true);
          }}
        >
          Create a group from{" "}
          {multiSelection.size > 1 ? "the selection" : "this"}…
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          data-menu="delete"
          disabled={deleted}
          onClick={() => {
            send(changeFor.delete(structure));
          }}
        >
          Propose deleting
        </MenuItem>
        {chapter.failure === undefined ? null : (
          <p
            role="alert"
            data-menu-chapter-failure
            className="border-refused max-w-56 border-l-2 px-2 py-1"
          >
            {chapter.failure}
          </p>
        )}
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
