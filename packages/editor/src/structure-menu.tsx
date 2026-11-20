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
  createMenuController,
} from "@axonometric/ui/components/menu";
import { Array as Arr, Option } from "effect";
import { useState } from "react";

import { useRevealToggle } from "./chapter-reveal.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useNewGroupForm } from "./new-group-context.ts";
import { useContextMenu } from "./open-context-menu.ts";
import { useProposed } from "./proposed-context.ts";
import { useSelection } from "./selection-context.ts";
import { changeFor, shapeChoices, statusChoices } from "./structure-actions.ts";
import { useStructuresById } from "./structures.ts";
import { useChapterPropose } from "./use-chapter-propose.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const idOfStructure = (target: Element) =>
  target.closest<SVGElement>("[data-structure]")?.dataset.structure;

/**
 * The context menu on a structure: a right-click on it opens a menu to
 * propose deleting it or changing its name, shape, group or status. It works
 * in both views and every chapter, because the map's structure targets carry
 * their id and the menu listens for the right-click on the whole page.
 *
 * The menu opens at the pointer, or at the focused structure for Shift+F10 and
 * the context-menu key, which the browser reports as the same event. The
 * structure is selected too, so its panel shows the same actions and the
 * result of the proposal.
 */
export function StructureMenu() {
  const proposing = useProposed();
  const byId = useStructuresById();
  const { select } = useSelection();
  // oxlint-disable-next-line react/hook-use-state -- the controller is made once and never replaced.
  const [menu] = useState(() => createMenuController());
  const [opened, setOpened] = useState<string | null>(null);
  const [handOffFocus, setHandOffFocus] = useState(false);

  const canPropose = proposing?.canPropose === true;

  useContextMenu({
    enabled: canPropose,
    idOf: idOfStructure,
    menu,
    onOpen: (id) => {
      select(id);
      setOpened(id);
    },
  });

  const structure: Structure | undefined =
    opened === null ? undefined : byId.get(opened);

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
        aria-label={structure?.name}
        data-structure-menu={structure?.id}
        finalFocus={handOffFocus ? "none" : "trigger"}
      >
        {structure === undefined || proposing === null ? null : (
          <StructureMenuItems
            handOffFocus={() => {
              setHandOffFocus(true);
            }}
            proposing={proposing}
            structure={structure}
          />
        )}
      </MenuContent>
    </Menu>
  );
}

/** The entries for one structure, rendered while the menu is open on it. */
function StructureMenuItems({
  handOffFocus,
  proposing,
  structure,
}: {
  readonly handOffFocus: () => void;
  readonly proposing: NonNullable<ReturnType<typeof useProposed>>;
  readonly structure: Structure;
}) {
  const { state } = useWalkthrough();
  const { failure, send } = usePropose();
  const chapter = useChapterPropose();
  const newGroup = useNewGroupForm();
  const { multiSelection, setMultiSelection } = useSelection();
  const drafting = useHopDraft();
  const reveal = useRevealToggle(structure.id);

  const deleted = marked(proposing.proposed, removedMark).has(structure.id);

  return (
    <>
      <MenuLabel>{structure.name}</MenuLabel>
      <MenuItem
        data-menu="rename"
        disabled={deleted}
        onSelect={() => {
          // The panel is open for the selected structure; its name field
          // takes the focus, so the menu doesn't give it back to the trigger.
          handOffFocus();
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
            onValueChange={(next) => {
              const choice = Option.getOrUndefined(
                Arr.findFirst(shapeChoices, ({ value }) => value === next)
              );

              if (choice !== undefined) {
                send(changeFor.shape(structure, choice.value));
              }
            }}
            value={structure.shape}
          >
            {Arr.map(shapeChoices, ({ label, value }) => (
              <MenuRadioItem data-menu-shape={value} key={value} value={value}>
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
            onValueChange={(next: string) => {
              send(changeFor.group(structure, next));
            }}
            value={structure.group}
          >
            {Arr.map(state.data.groups, ({ id, title }) => (
              <MenuRadioItem data-menu-group={id} key={id} value={id}>
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
            onValueChange={(next) => {
              const choice = Option.getOrUndefined(
                Arr.findFirst(statusChoices, ({ value }) => value === next)
              );

              if (choice !== undefined) {
                send(changeFor.status(structure, choice.value));
              }
            }}
            value={structure.status}
          >
            {Arr.map(statusChoices, ({ label, value }) => (
              <MenuRadioItem data-menu-status={value} key={value} value={value}>
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
          onSelect={() => {
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
          onSelect={() => {
            chapter.send(reveal.change);
          }}
        >
          {reveal.label}
        </MenuItem>
      )}
      <MenuItem
        data-menu="new-group"
        onSelect={() => {
          // The structure joins the multi-selection, so the form's
          // "moves … into it" line names it.
          if (!multiSelection.has(structure.id)) {
            setMultiSelection([...multiSelection, structure.id]);
          }

          newGroup?.setOpen(true);
        }}
      >
        Create a group from {multiSelection.size > 1 ? "the selection" : "this"}
        …
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        data-menu="delete"
        disabled={deleted}
        onSelect={() => {
          send(changeFor.delete(structure));
        }}
      >
        Propose deleting
      </MenuItem>
      {chapter.failure === undefined ? null : (
        <p
          className="border-refused max-w-56 border-l-2 px-2 py-1"
          data-menu-chapter-failure
          role="alert"
        >
          {chapter.failure}
        </p>
      )}
      {failure === undefined ? null : (
        <p
          className="border-refused max-w-56 border-l-2 px-2 py-1"
          data-menu-failure
          role="alert"
        >
          {failure}
        </p>
      )}
    </>
  );
}
