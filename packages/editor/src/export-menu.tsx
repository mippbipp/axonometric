import {
  excalidrawOf,
  exportName,
  whiteBackground,
} from "@axonometric/contracts";
import type { View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Effect } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";

import { controlClass } from "./control-class.ts";
import { download, ExportFailed, exportSvg, pngOf } from "./svg-export.ts";
import type { ExportLabel } from "./svg-export.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** How much larger than the SVG the PNG is drawn. */
const pngScale = 2;

const viewNames = {
  iso: "Iso view",
  plan: "Plan view",
} as const satisfies Record<View, string>;

/** The map's drawing on the page: the pan-and-zoom group of its view. */
const drawnMap = () => {
  const world = document.querySelector("[data-map-layer] [data-viewport]");

  return world instanceof SVGGElement ? world : null;
};

const items = ["svg", "png", "excalidraw", "background"] as const;

type Item = (typeof items)[number];

/** The items that save a file. */
type Export = Exclude<Item, "background">;

const itemClass =
  "focus-visible:bg-ink focus-visible:text-paper hover:bg-ink hover:text-paper flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-xs outline-none";

/** One row of the menu. A `checked` row is a checkbox, drawn as one. */
function MenuItem({
  item,
  itemRef,
  checked,
  onChoose,
  children,
}: {
  readonly item: Item;
  readonly itemRef: Ref<HTMLButtonElement>;
  /** Whether a checkbox row is checked. Leave out for a row that saves. */
  readonly checked?: boolean;
  readonly onChoose: () => void;
  readonly children: ReactNode;
}) {
  const isCheckbox = checked !== undefined;

  return (
    <button
      ref={itemRef}
      type="button"
      role={isCheckbox ? "menuitemcheckbox" : "menuitem"}
      aria-checked={checked}
      tabIndex={-1}
      data-export-item={item}
      className={itemClass}
      onClick={onChoose}
    >
      {isCheckbox ? (
        <span aria-hidden="true" className="w-3 text-sm leading-none">
          {checked ? "☑" : "☐"}
        </span>
      ) : null}
      {children}
    </button>
  );
}

/**
 * The header's Export button and its menu: the current view and chapter as
 * SVG or PNG, the whole map as an Excalidraw file, and a "White background"
 * checkbox that replaces the paper colour. The arrow keys, Home and End move
 * through the menu, and Escape or Tab closes it, with focus back on the
 * button. Files save through a download link, so export works in the
 * read-only file too. A failed export says so in a live region and saves
 * nothing.
 */
export function ExportMenu({ view }: { readonly view: View }) {
  const { state, stop, index, stops } = useWalkthrough();
  const [open, setOpen] = useState(false);
  const [onWhite, setOnWhite] = useState(false);
  const [problem, setProblem] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<Item, HTMLElement>());
  const menuId = useId();
  const chapter = index + 1;
  const name = exportName({ system: state.system, view, chapter });

  const close = (refocus: boolean) => {
    setOpen(false);

    if (refocus) {
      buttonRef.current?.focus();
    }
  };

  useEffect(() => {
    if (open) {
      itemRefs.current.get("svg")?.focus();
    }
  }, [open]);

  // A press anywhere else closes the menu.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;

      if (
        target instanceof Node &&
        menuRef.current?.contains(target) !== true &&
        buttonRef.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const label = (): ExportLabel => ({
    prefix: `${name}-`,
    title: `${state.data.overview.title}: ${viewNames[view]}, chapter ${chapter}`,
    description: `${viewNames[view]} of ${state.data.overview.title}, at chapter ${chapter} of ${stops.length}, ${stop.title}. ${stop.lede}`,
    background: onWhite ? "white" : "paper",
  });

  const svgFile = () => {
    const world = drawnMap();

    return world === null
      ? Effect.fail(
          ExportFailed.make({ reason: "The map isn't on the page to export." })
        )
      : exportSvg({ world, label: label() });
  };

  const actions: Readonly<
    Record<Export, () => Effect.Effect<void, ExportFailed>>
  > = {
    svg: () =>
      svgFile().pipe(
        Effect.tap((file) =>
          Effect.sync(() => {
            download(
              new Blob([file.text], { type: "image/svg+xml" }),
              `${name}.svg`
            );
          })
        ),
        Effect.asVoid
      ),
    png: () =>
      svgFile().pipe(
        Effect.flatMap((file) => pngOf(file, pngScale)),
        Effect.tap((png) =>
          Effect.sync(() => {
            download(png, `${name}.png`);
          })
        ),
        Effect.asVoid
      ),
    excalidraw: () =>
      Effect.sync(() => {
        const file = excalidrawOf({
          data: state.data,
          layout: state.layout,
          background: onWhite ? whiteBackground : undefined,
        });

        download(
          // oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- excalidrawOf's output is plain JSON data by construction
          new Blob([`${JSON.stringify(file, null, 2)}\n`], {
            type: "application/json",
          }),
          `${state.system}.excalidraw`
        );
      }),
  };

  const run = (item: Export) => {
    close(true);
    setProblem("");
    Effect.runFork(
      actions[item]().pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            setProblem(`Couldn't export the ${item}. Nothing was saved.`);
          })
        )
      )
    );
  };

  const move = (from: Item, by: number) => {
    const at = items.indexOf(from);
    const next = items[(at + by + items.length) % items.length];

    if (next !== undefined) {
      itemRefs.current.get(next)?.focus();
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The map's own keys, such as → for the next chapter or v for the
    // other view, stay off while the menu has focus.
    event.stopPropagation();

    const current = items.find(
      (item) => itemRefs.current.get(item) === document.activeElement
    );

    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // Focus goes back to the button first, so Tab moves on from there
      // instead of from a menu that's about to disappear.
      close(true);
    } else if (current === undefined) {
      // Only the items below move focus.
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      move(current, 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(current, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(items[0], 0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(items.at(-1) ?? current, 0);
    }
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    }
  };

  const itemRef = (item: Item) => (element: HTMLElement | null) => {
    if (element === null) {
      itemRefs.current.delete(item);
    } else {
      itemRefs.current.set(item, element);
    }
  };

  return (
    <div className="relative flex">
      <button
        ref={buttonRef}
        type="button"
        data-control="export"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(controlClass, open && "bg-ink text-paper")}
        onClick={() => {
          if (open) {
            close(true);
          } else {
            setOpen(true);
          }
        }}
        onKeyDown={onButtonKey}
      >
        Export
      </button>
      <output
        aria-live="polite"
        data-export-problem=""
        className={cn(
          "border-ink bg-paper text-ink absolute top-full right-0 z-30 mt-1 w-56 border px-3 py-1 text-xs",
          problem === "" && "sr-only"
        )}
      >
        {problem}
      </output>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          data-export-menu=""
          role="menu"
          aria-label="Export"
          tabIndex={-1}
          className="border-ink bg-paper text-ink absolute top-full right-0 z-30 mt-1 flex w-56 flex-col border py-1"
          onKeyDown={onMenuKey}
        >
          <MenuItem
            item="svg"
            itemRef={itemRef("svg")}
            onChoose={() => {
              run("svg");
            }}
          >
            SVG of this view and chapter
          </MenuItem>
          <MenuItem
            item="png"
            itemRef={itemRef("png")}
            onChoose={() => {
              run("png");
            }}
          >
            PNG of this view and chapter
          </MenuItem>
          <MenuItem
            item="excalidraw"
            itemRef={itemRef("excalidraw")}
            onChoose={() => {
              run("excalidraw");
            }}
          >
            Excalidraw file of the whole map
          </MenuItem>
          <hr className="border-ink my-1" />
          <MenuItem
            item="background"
            itemRef={itemRef("background")}
            checked={onWhite}
            onChoose={() => {
              setOnWhite((current) => !current);
            }}
          >
            White background
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}
