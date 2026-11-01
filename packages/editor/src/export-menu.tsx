import { excalidrawOf } from "@axonometric/contracts";
import type { View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Effect } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { controlClass } from "./control-class.ts";
import {
  download,
  exportIdPrefix,
  exportSvg,
  pngOf,
  textUrl,
} from "./svg-export.ts";
import type { ExportLabel, PngFailed } from "./svg-export.ts";
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

const items = ["svg", "png", "excalidraw", "white"] as const;

type Item = (typeof items)[number];

/**
 * The header's Export button and its menu: the current view and chapter as
 * SVG or PNG, the whole map as an Excalidraw file, and a "White background"
 * checkbox that replaces the paper colour. The arrow keys, Home and End move
 * through the menu, and Escape or Tab closes it, with focus back on the
 * button. Files save through a download link, so export works in the
 * read-only file too.
 */
export function ExportMenu({ view }: { readonly view: View }) {
  const { state, stop, index, stops } = useWalkthrough();
  const [open, setOpen] = useState(false);
  const [white, setWhite] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<Item, HTMLElement>());
  const menuId = useId();
  const chapter = index + 1;
  const base = `${state.system}-${view}-chapter-${chapter}`;

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
    prefix: exportIdPrefix({ system: state.system, view, chapter }),
    title: `${state.data.overview.title}: ${viewNames[view]}, chapter ${chapter}`,
    description: `${viewNames[view]} of ${state.data.overview.title}, at chapter ${chapter} of ${stops.length}, ${stop.title}. ${stop.lede}`,
    background: white ? "white" : "paper",
  });

  const svgFile = () => {
    const world = drawnMap();

    return world === null ? null : exportSvg({ world, label: label() });
  };

  const actions: Readonly<
    Record<Exclude<Item, "white">, () => Effect.Effect<void, PngFailed>>
  > = {
    svg: () =>
      Effect.sync(() => {
        const file = svgFile();

        if (file !== null) {
          download(textUrl(file.text, "image/svg+xml"), `${base}.svg`);
        }
      }),
    png: () => {
      const file = svgFile();

      return file === null
        ? Effect.void
        : pngOf(file, pngScale).pipe(
            Effect.tap((png) =>
              Effect.sync(() => {
                download(png, `${base}.png`);
              })
            ),
            Effect.asVoid
          );
    },
    excalidraw: () =>
      Effect.sync(() => {
        const file = excalidrawOf({
          data: state.data,
          layout: state.layout,
          background: white ? "#ffffff" : undefined,
        });

        download(
          // oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- excalidrawOf's output is plain JSON data by construction
          textUrl(`${JSON.stringify(file, null, 2)}\n`, "application/json"),
          `${state.system}.excalidraw`
        );
      }),
  };

  const run = (item: Exclude<Item, "white">) => {
    close(true);
    Effect.runFork(
      actions[item]().pipe(
        Effect.catch((error) => Effect.logError(error.reason))
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
      close(false);
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

  const itemClass =
    "focus-visible:bg-ink focus-visible:text-paper hover:bg-ink hover:text-paper flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-xs outline-none";

  return (
    <div className="relative">
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
          <button
            ref={itemRef("svg")}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-export="svg"
            className={itemClass}
            onClick={() => {
              run("svg");
            }}
          >
            SVG of this view and chapter
          </button>
          <button
            ref={itemRef("png")}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-export="png"
            className={itemClass}
            onClick={() => {
              run("png");
            }}
          >
            PNG of this view and chapter
          </button>
          <button
            ref={itemRef("excalidraw")}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-export="excalidraw"
            className={itemClass}
            onClick={() => {
              run("excalidraw");
            }}
          >
            Excalidraw file of the whole map
          </button>
          <hr className="border-ink my-1" />
          <button
            ref={itemRef("white")}
            type="button"
            role="menuitemcheckbox"
            tabIndex={-1}
            aria-checked={white}
            data-export-option="white"
            className={itemClass}
            onClick={() => {
              setWhite((current) => !current);
            }}
          >
            <span aria-hidden="true" className="w-3">
              {white ? "✓" : ""}
            </span>
            White background
          </button>
        </div>
      ) : null}
    </div>
  );
}
