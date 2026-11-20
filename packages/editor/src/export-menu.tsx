import {
  excalidrawOf,
  excalidrawText,
  exportName,
  pngScale,
  svgRequestOf,
  whiteBackground,
} from "@axonometric/contracts";
import type { View } from "@axonometric/contracts";
import { svgFileOf } from "@axonometric/drawing";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@axonometric/ui/components/menu";
import { cn } from "@axonometric/ui/lib/utils";
import { Effect } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { useExportState } from "./export-state-context.ts";
import { useSpotlightActions } from "./spotlight-context.ts";
import { download, ExportFailed, pngOf } from "./svg-export.ts";
import { shownTheme } from "./theme-state.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** The items that save a file. */
type Export = "excalidraw" | "png" | "svg";

/**
 * The header's Export button and its menu: the current view and chapter as
 * SVG or PNG, the whole map as an Excalidraw file, and a "White background"
 * checkbox that replaces the paper colour and leaves the menu open. The menu
 * keys are ui-sdk's: the arrow keys, Home and End move through it, and
 * Escape or Tab closes it, with focus back on the button. Files save through
 * a download link, so export works in the read-only file too. A failed
 * export says so in a live region and saves nothing.
 */
export function ExportMenu({ view }: { readonly view: View }) {
  const { flowChoice, index, state: shown } = useWalkthrough();
  // Proposals are drawn on the page and left out of what it saves.
  const state = useExportState() ?? shown;
  const targetsNow = useSpotlightActions().current;
  const [onWhite, setOnWhite] = useState(false);
  const [problem, setProblem] = useState("");
  const chapter = index + 1;
  const name = exportName({ chapter, system: state.system, view });

  const svgFile = () =>
    Effect.try({
      catch: () => ExportFailed.make({ reason: "The map couldn't be drawn." }),
      try: () =>
        svgFileOf(
          svgRequestOf({
            background: onWhite ? "white" : "paper",
            chapter: index,
            choice: flowChoice,
            ...targetsNow(),
            state,
            theme: shownTheme(),
            view,
          })
        ),
    });

  const actions: Readonly<
    Record<Export, () => Effect.Effect<void, ExportFailed>>
  > = {
    excalidraw: () =>
      Effect.sync(() => {
        const file = excalidrawOf({
          background: onWhite ? whiteBackground : undefined,
          data: state.data,
          layout: state.layout,
        });

        download(
          new Blob([excalidrawText(file)], { type: "application/json" }),
          `${state.system}.excalidraw`
        );
      }),
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
  };

  const run = (item: Export) => {
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

  return (
    <div className="relative flex">
      <Menu>
        <MenuTrigger
          className={cn(
            controlClass,
            "aria-expanded:bg-ink aria-expanded:text-paper"
          )}
          data-control="export"
        >
          Export
        </MenuTrigger>
        <MenuContent
          align="end"
          aria-label="Export"
          className="min-w-56"
          data-export-menu=""
          onKeyDown={(event) => {
            // The map's own keys, such as → for the next chapter or v for
            // the other view, stay off while the menu has focus.
            event.stopPropagation();
          }}
        >
          <MenuItem
            data-export-item="svg"
            onSelect={() => {
              run("svg");
            }}
          >
            SVG of this view and chapter
          </MenuItem>
          <MenuItem
            data-export-item="png"
            onSelect={() => {
              run("png");
            }}
          >
            PNG of this view and chapter
          </MenuItem>
          <MenuItem
            data-export-item="excalidraw"
            onSelect={() => {
              run("excalidraw");
            }}
          >
            Excalidraw file of the whole map
          </MenuItem>
          <MenuSeparator />
          <MenuCheckboxItem
            checked={onWhite}
            data-export-item="background"
            onCheckedChange={setOnWhite}
            value="background"
          >
            White background
          </MenuCheckboxItem>
        </MenuContent>
      </Menu>
      <output
        aria-live="polite"
        className={cn(
          "border-ink bg-paper text-ink absolute top-full right-0 z-30 mt-1 w-56 border px-3 py-1 text-xs",
          problem === "" && "sr-only"
        )}
        data-export-problem=""
      >
        {problem}
      </output>
    </div>
  );
}
