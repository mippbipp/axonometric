import {
  CanvasItem,
  CanvasItems,
} from "@axonometric/ui/components/canvas-items";
import { PannableCanvas } from "@axonometric/ui/components/pannable-canvas";
import type {
  Camera,
  CameraDetails,
} from "@axonometric/ui/components/pannable-canvas";
import {
  TooltipTrigger,
  createTooltipController,
} from "@axonometric/ui/components/tooltip";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { Array as Arr } from "effect";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

/** Where each item sits on screen, as a 10 px square at its corner. */
const places = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 0, y: 100 },
  far: { x: 5000, y: 5000 },
  p: { x: 100, y: 100 },
} as const;

type Key = keyof typeof places;

const names: Readonly<Record<Key, string>> = {
  a: "Alpha",
  b: "Bravo",
  c: "Charlie",
  far: "Far",
  p: "Packet",
};

const rectAt = ({ x, y }: { readonly x: number; readonly y: number }) =>
  DOMRect.fromRect({ height: 10, width: 10, x, y });

const placed = (el: SVGGElement | null, key: Key) => {
  if (el !== null) {
    el.getBoundingClientRect = () => rectAt(places[key]);
  }
};

interface Calls {
  readonly onCameraChange: (camera: Camera, details: CameraDetails) => void;
  readonly onOpen: (key: Key) => void;
  readonly onPress: (key: Key, event?: Event) => void;
  readonly onSelectedChange: (value: Array<string>) => void;
}

const spies = (): Calls => ({
  onCameraChange: vi.fn<Calls["onCameraChange"]>(),
  onOpen: vi.fn<Calls["onOpen"]>(),
  onPress: vi.fn<Calls["onPress"]>(),
  onSelectedChange: vi.fn<Calls["onSelectedChange"]>(),
});

/** Structures a, b, c and far are selectable and open; p is a packet that only presses. */
function Map({
  calls,
  multiple = true,
  pinned = null,
}: {
  readonly calls: Calls;
  readonly multiple?: boolean;
  readonly pinned?: Key | null;
}) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const controller = createTooltipController<string>();

  return (
    <>
      <button type="button">before</button>
      <PannableCanvas
        claims={() => true}
        fit={() => ({ x: 0, y: 0, zoom: 1 })}
        limits={() => ({ max: 4, min: 0.25 })}
        onCameraChange={(camera, details) => {
          calls.onCameraChange(camera, details);
        }}
        title="Map"
      >
        <CanvasItems
          multiple={multiple}
          onSelectedChange={(value) => {
            calls.onSelectedChange(value);
            setSelected(value);
          }}
          pinned={pinned}
          selected={selected}
        >
          {Arr.map(["a", "b", "c", "far"] as const, (key) => (
            <TooltipTrigger
              controller={controller}
              key={key}
              payload={key}
              render={
                <CanvasItem
                  aria-label={names[key]}
                  aria-pressed={pinned === key}
                  data-selected-here={selected.includes(key) ? "" : undefined}
                  onOpen={() => {
                    calls.onOpen(key);
                  }}
                  onPress={(event) => {
                    calls.onPress(key, event);
                  }}
                  ref={(el) => {
                    placed(el, key);
                  }}
                  selectable
                  value={key}
                />
              }
            >
              <rect height="10" width="10" />
            </TooltipTrigger>
          ))}
          <CanvasItem
            aria-label={names.p}
            onPress={(event) => {
              calls.onPress("p", event);
            }}
            ref={(el) => {
              placed(el, "p");
            }}
            value="packet:p"
          >
            <circle r="5" />
          </CanvasItem>
        </CanvasItems>
      </PannableCanvas>
      <button type="button">after</button>
    </>
  );
}

const item = (key: Key) => screen.getByRole("button", { name: names[key] });

const stops = () =>
  Arr.flatMap(
    [...document.querySelectorAll('[data-slot="canvas-items-item"]')],
    (el) =>
      el.getAttribute("tabindex") === "0" ? [el.getAttribute("aria-label")] : []
  );

const mount = async (props: Partial<Parameters<typeof Map>[0]> = {}) => {
  const calls = spies();

  render(<Map calls={calls} {...props} />);
  await act(settle);

  return calls;
};

const focusOn = (key: Key) => {
  act(() => {
    item(key).focus();
  });
};

describe("canvas items", () => {
  it("gives each item the button role from the slot, on a <g>", async () => {
    expect.hasAssertions();

    await mount({ pinned: "b" });

    for (const key of ["a", "b", "c", "far", "p"] as const) {
      expect(item(key).tagName).toBe("g");
    }

    expect(item("b").getAttribute("aria-pressed")).toBe("true");
    expect(item("a").getAttribute("aria-pressed")).toBe("false");
  });

  it("has one Tab stop, on the first item, and Tab leaves in one press", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    await mount();

    expect(stops()).toStrictEqual(["Alpha"]);

    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();

    expect(document.activeElement).toBe(item("a"));

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "after" })
    );
  });

  it("puts the Tab stop on the pinned item", async () => {
    expect.hasAssertions();

    await mount({ pinned: "c" });

    expect(stops()).toStrictEqual(["Charlie"]);
  });

  it("moves focus to the nearest item on screen in the arrow's direction", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    await mount();
    focusOn("a");

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(item("b"));

    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(item("p"));

    await user.keyboard("{ArrowLeft}");

    expect(document.activeElement).toBe(item("c"));

    await user.keyboard("{ArrowUp}");

    expect(document.activeElement).toBe(item("a"));
    expect(stops()).toStrictEqual(["Alpha"]);
  });

  it("moves to the first and last item in document order with Home and End", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    await mount();
    focusOn("b");

    await user.keyboard("{End}");

    expect(document.activeElement).toBe(item("p"));

    await user.keyboard("{Home}");

    expect(document.activeElement).toBe(item("a"));
  });

  it("prevents a plain arrow even at an edge, and leaves Alt+arrow alone", async () => {
    expect.hasAssertions();

    await mount();
    focusOn("a");

    const notDefaultPrevented = [
      fireEvent.keyDown(item("a"), { key: "ArrowLeft" }),
      fireEvent.keyDown(item("a"), { key: "ArrowUp", shiftKey: true }),
      fireEvent.keyDown(item("a"), { altKey: true, key: "ArrowRight" }),
    ];

    expect(notDefaultPrevented).toStrictEqual([false, false, true]);
    expect(document.activeElement).toBe(item("a"));
  });

  it("opens with Enter, and presses with Space and a click", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount();

    focusOn("b");
    await user.keyboard("{Enter}");

    expect(calls.onOpen).toHaveBeenCalledExactlyOnceWith("b");
    expect(calls.onPress).not.toHaveBeenCalled();

    await user.keyboard(" ");
    await user.click(item("c"));

    expect(
      Arr.map(vi.mocked(calls.onPress).mock.calls, ([key]) => key)
    ).toStrictEqual(["b", "c"]);
    expect(vi.mocked(calls.onOpen).mock.calls).toStrictEqual([["b"]]);
  });

  it("presses an item without onOpen with Enter", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount();

    focusOn("p");
    await user.keyboard("{Enter}");

    expect(
      Arr.map(vi.mocked(calls.onPress).mock.calls, ([key]) => key)
    ).toStrictEqual(["p"]);
  });

  it("toggles the selection with Shift+Enter, Shift+Space and Shift-click", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount();

    focusOn("a");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await act(settle);
    focusOn("b");
    await user.keyboard("{Shift>} {/Shift}");
    await act(settle);
    await user.keyboard("{Shift>}");
    await user.click(item("a"));
    await user.keyboard("{/Shift}");
    await act(settle);

    expect(vi.mocked(calls.onSelectedChange).mock.calls).toStrictEqual([
      [["a"]],
      [["a", "b"]],
      [["b"]],
    ]);
    expect(calls.onPress).not.toHaveBeenCalled();
    expect(calls.onOpen).not.toHaveBeenCalled();
    expect(item("b").dataset.selectedHere).toBe("");
    expect(item("a").dataset.selectedHere).toBeUndefined();
  });

  it("keeps the pinned item in the selection on the first Shift press", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount({ pinned: "a" });

    focusOn("c");
    await user.keyboard("{Shift>} {/Shift}");
    await act(settle);

    expect(vi.mocked(calls.onSelectedChange).mock.calls).toStrictEqual([
      [["a", "c"]],
    ]);
  });

  it("presses a Shift press on an item that isn't selectable", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount();

    focusOn("p");
    await user.keyboard("{Shift>} {/Shift}");

    expect(calls.onSelectedChange).not.toHaveBeenCalled();
    expect(vi.mocked(calls.onPress).mock.calls[0]?.[0]).toBe("p");
  });

  it("presses a Shift press without multiple", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount({ multiple: false });

    focusOn("a");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("{Shift>}");
    await user.click(item("b"));
    await user.keyboard("{/Shift}");

    expect(calls.onSelectedChange).not.toHaveBeenCalled();
    expect(
      Arr.map(vi.mocked(calls.onPress).mock.calls, ([key]) => key)
    ).toStrictEqual(["a", "b"]);
  });

  it("pans an item that takes keyboard focus off screen into view", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();
    const calls = await mount();

    focusOn("p");
    vi.mocked(calls.onCameraChange).mockClear();
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(item("far"));
    expect(vi.mocked(calls.onCameraChange).mock.calls.at(-1)?.[1].reason).toBe(
      "focus-in"
    );
  });
});
