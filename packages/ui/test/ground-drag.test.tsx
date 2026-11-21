import {
  GroundDrag,
  GroundHandle,
} from "@axonometric/ui/components/ground-drag";
import type {
  GroundBox,
  GroundDraft,
  GroundDragOptions,
  GroundPoint,
} from "@axonometric/ui/components/ground-drag";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

type OnMove = GroundDragOptions["onMove"];
type OnResize = GroundDragOptions["onResize"];
type OnDraft = (draft: GroundDraft | null) => void;

/**
 * The Iso view's ground: a unit along x is 36 px right and 18 down, and
 * along y 36 left and 18 down, so a straight screen drag moves on both axes.
 */
const toScreen = ({ x, y }: GroundPoint) => ({
  clientX: (x - y) * 36,
  clientY: (x + y) * 18,
});

const toGround = ({
  clientX,
  clientY,
}: {
  readonly clientX: number;
  readonly clientY: number;
}) => ({
  x: (clientX / 36 + clientY / 18) / 2,
  y: (clientY / 18 - clientX / 36) / 2,
});

const boxes = {
  a: { height: 2, width: 2, x: 1, y: 1 },
  b: { height: 1, width: 1, x: 5, y: 1 },
  hidden: { height: 1, width: 1, x: 8, y: 8 },
} as const satisfies Record<string, GroundBox>;

interface Calls {
  readonly onDraft: OnDraft;
  readonly onMove: OnMove;
  readonly onResize: OnResize;
}

const spies = (accept = true): Calls => ({
  onDraft: vi.fn<OnDraft>(),
  onMove: vi.fn<OnMove>(() => accept),
  onResize: vi.fn<OnResize>(() => accept),
});

/**
 * Items a and b, and a's handles. A press on a moves a, b and the hidden
 * item that's never drawn; a press on b moves b. Alt and an arrow move the
 * focused item. What a call accepts lands in the boxes.
 */
function Canvas({
  calls: { onDraft, onMove, onResize },
}: {
  readonly calls: Calls;
}) {
  const [shown, setShown] =
    useState<Readonly<Record<string, GroundBox>>>(boxes);

  return (
    <>
      <input aria-label="Name" />
      <svg>
        <GroundDrag
          boxes={shown}
          data-testid="root"
          groundAt={(_el, at) => toGround(at)}
          keysFor={(target, input) => {
            const key =
              target?.closest<SVGElement>("[data-item]")?.dataset.item;

            if (key === "a" && input === "pointer") {
              return ["a", "b", "hidden"];
            }

            return key === undefined ? undefined : [key];
          }}
          label={(key) => `Item ${key}`}
          largeStep={2}
          minSize={0.5}
          onDraft={(draft) => {
            onDraft(draft);
          }}
          onMove={(to, details) => {
            const done = onMove(to, details);

            if (done) {
              setShown((before) => {
                const next = { ...before };

                for (const key of ["a", "b", "hidden"]) {
                  const box = next[key];
                  const at = to[key];

                  if (box !== undefined && at !== undefined) {
                    next[key] = { ...box, ...at };
                  }
                }

                return next;
              });
            }

            return done;
          }}
          onResize={(key, box, details) => {
            const done = onResize(key, box, details);

            if (done) {
              setShown((before) => ({ ...before, [key]: box }));
            }

            return done;
          }}
          step={0.5}
        >
          <g aria-label="Item a" data-item="a" tabIndex={0}>
            <rect height="10" width="10" />
          </g>
          <g aria-label="Item b" data-item="b" tabIndex={-1}>
            <rect height="10" width="10" />
          </g>
          {(["nw", "ne", "se", "sw"] as const).map((corner) => (
            <GroundHandle
              aria-label={`Resize a from ${corner}`}
              corner={corner}
              height={12}
              key={corner}
              owner="a"
              width={12}
              x={0}
              y={0}
            />
          ))}
        </GroundDrag>
      </svg>
    </>
  );
}

const mount = async (calls = spies()) => {
  render(<Canvas calls={calls} />);
  await act(settle);

  return calls;
};

const pointer = (at: {
  readonly clientX: number;
  readonly clientY: number;
}) => ({
  ...at,
  button: 0,
  buttons: 1,
  pointerId: 1,
  pointerType: "mouse",
});

const item = (key: string) => {
  const el = document.querySelector<SVGGElement>(`[data-item="${key}"]`);

  if (el === null) {
    throw new TypeError(`Item ${key} isn't mounted.`);
  }

  return el;
};

const handle = (corner: string) =>
  screen.getByRole("button", { name: `Resize a from ${corner}` });

const root = () => screen.getByTestId("root");

/** Presses `el` at the origin and moves the pointer to `to`, still pressed. */
const pressAndMove = (
  el: Element,
  to: { readonly clientX: number; readonly clientY: number }
) => {
  fireEvent.pointerDown(el, pointer({ clientX: 0, clientY: 0 }));
  fireEvent.pointerMove(document, pointer(to));
};

/** Presses `el`, drags it by `by` on the ground and lets go. */
const dragBy = (el: Element, by: GroundPoint) => {
  pressAndMove(el, toScreen(by));
  fireEvent.pointerUp(document, pointer(toScreen(by)));
};

const announced = () =>
  document.querySelector('[data-ui-sdk-announcer="assertive"]')?.textContent ??
  "";

/** Long enough for an announcement, which ui-sdk writes after 100 ms. */
const announcement = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 150);
      })
  );

const lastDraft = (calls: Calls) =>
  vi
    .mocked(calls.onDraft)
    .mock.calls.map(([draft]) => draft)
    .findLast((draft) => draft !== null);

describe("ground drag", () => {
  it("moves along the ground through groundAt, so a straight screen drag moves on both axes", async () => {
    expect.hasAssertions();

    const calls = await mount();

    // Straight down by 36 px is one unit along x and along y.
    pressAndMove(item("b"), { clientX: 0, clientY: 36 });
    fireEvent.pointerUp(document, pointer({ clientX: 0, clientY: 36 }));

    expect(calls.onMove).toHaveBeenCalledExactlyOnceWith(
      { b: { x: 6, y: 2 } },
      { input: "pointer" }
    );
  });

  it("leaves a press that moves 2 px a click", async () => {
    expect.hasAssertions();

    const calls = await mount();
    const onClick = vi.fn<() => void>();

    document.addEventListener("click", onClick);
    pressAndMove(item("b"), { clientX: 2, clientY: 2 });
    fireEvent.pointerUp(document, pointer({ clientX: 2, clientY: 2 }));
    fireEvent.click(item("b"));
    document.removeEventListener("click", onClick);

    expect(calls.onDraft).not.toHaveBeenCalled();
    expect(calls.onMove).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledExactlyOnceWith(expect.anything());
  });

  it("drags a press that moves 3 px, and swallows the click after it", async () => {
    expect.hasAssertions();

    const calls = await mount();
    const onClick = vi.fn<() => void>();

    document.addEventListener("click", onClick);
    pressAndMove(item("b"), { clientX: 3, clientY: 0 });

    await waitFor(() => {
      expect(root().dataset.dragging).toBe("b");
    });

    fireEvent.pointerUp(document, pointer({ clientX: 3, clientY: 0 }));
    fireEvent.click(item("b"));
    document.removeEventListener("click", onClick);

    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    expect(onClick).not.toHaveBeenCalled();
    expect(root().dataset.dragging).toBeUndefined();
  });

  it("drops once with every key, the hidden one too, where the last draft showed", async () => {
    expect.hasAssertions();

    const calls = await mount();

    // 1.3 lands on 1.5 and 0.8 on 1: each position snaps to half a unit.
    dragBy(item("a"), { x: 0.3, y: -0.2 });

    const committed = {
      a: { x: 1.5, y: 1 },
      b: { x: 5.5, y: 1 },
      hidden: { x: 8.5, y: 8 },
    };

    expect(calls.onMove).toHaveBeenCalledExactlyOnceWith(committed, {
      input: "pointer",
    });
    expect(lastDraft(calls)).toStrictEqual({
      from: { a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, hidden: { x: 8, y: 8 } },
      keys: ["a", "b", "hidden"],
      kind: "move",
      to: committed,
    });
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
  });

  it("puts a drag back on Escape and commits nothing", async () => {
    expect.hasAssertions();

    const calls = await mount();

    pressAndMove(item("b"), toScreen({ x: 2, y: 0 }));

    await waitFor(() => {
      expect(root().dataset.dragging).toBe("b");
    });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(document, pointer(toScreen({ x: 2, y: 0 })));

    expect(calls.onMove).not.toHaveBeenCalled();
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    expect(root().dataset.dragging).toBeUndefined();
  });

  it("puts a corner drag back on Escape and commits nothing", async () => {
    expect.hasAssertions();

    const calls = await mount();

    pressAndMove(handle("se"), toScreen({ x: 1, y: 1 }));

    await waitFor(() => {
      expect(root().dataset.dragging).toBe("a");
    });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(document, pointer(toScreen({ x: 1, y: 1 })));

    expect(calls.onResize).not.toHaveBeenCalled();
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
  });

  it("leaves nothing behind when the drop is refused", async () => {
    expect.hasAssertions();

    const calls = await mount(spies(false));

    dragBy(item("b"), { x: 2, y: 0 });
    await announcement();

    expect(calls.onMove).toHaveBeenCalledExactlyOnceWith(
      { b: { x: 7, y: 1 } },
      { input: "pointer" }
    );
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    expect(root().dataset.dragging).toBeUndefined();
    expect(announced()).not.toBe("Item b moved to 7, 1.");
  });

  describe("alt and an arrow", () => {
    it("moves the focused item half a unit, and announces it", async () => {
      expect.hasAssertions();

      const calls = await mount();

      fireEvent.keyDown(item("b"), { altKey: true, key: "ArrowRight" });
      await announcement();

      expect(calls.onMove).toHaveBeenCalledExactlyOnceWith(
        { b: { x: 5.5, y: 1 } },
        { input: "keyboard" }
      );
      expect(announced()).toBe("Item b moved to 5.5, 1.");
    });

    it("starts each press from where the last one put the item", async () => {
      expect.hasAssertions();

      const calls = await mount();

      fireEvent.keyDown(item("b"), { altKey: true, key: "ArrowRight" });
      fireEvent.keyDown(item("b"), { altKey: true, key: "ArrowRight" });

      expect(vi.mocked(calls.onMove).mock.calls).toStrictEqual([
        [{ b: { x: 5.5, y: 1 } }, { input: "keyboard" }],
        [{ b: { x: 6, y: 1 } }, { input: "keyboard" }],
      ]);
    });

    it("moves the large step with Shift", async () => {
      expect.hasAssertions();

      const calls = await mount();

      fireEvent.keyDown(item("b"), {
        altKey: true,
        key: "ArrowUp",
        shiftKey: true,
      });

      expect(calls.onMove).toHaveBeenCalledExactlyOnceWith(
        { b: { x: 5, y: -1 } },
        { input: "keyboard" }
      );
    });

    it("writes nothing for a held key's repeats, and leaves a plain arrow and a field's keys alone", async () => {
      expect.hasAssertions();

      const calls = await mount();
      const field = screen.getByRole("textbox", { name: "Name" });

      const notDefaultPrevented = [
        fireEvent.keyDown(item("b"), {
          altKey: true,
          key: "ArrowDown",
          repeat: true,
        }),
        fireEvent.keyDown(item("b"), { key: "ArrowRight" }),
        fireEvent.keyDown(field, { altKey: true, key: "ArrowRight" }),
      ];

      expect(notDefaultPrevented).toStrictEqual([false, true, true]);
      expect(calls.onMove).not.toHaveBeenCalled();
    });
  });

  describe("corner handles", () => {
    it("are focusable buttons with a name", async () => {
      expect.hasAssertions();

      const user = userEvent.setup();

      await mount();
      item("a").focus();
      await user.tab();
      await user.tab();

      expect(document.activeElement).toBe(handle("ne"));
      expect(handle("se").dataset.resizeHandle).toBe("se");
    });

    it("resize by dragging, keeping the opposite corner, snapped, and at least half a unit", async () => {
      expect.hasAssertions();

      const calls = await mount();

      // a runs from (1, 1) to (3, 3). The se corner goes to (3.6, -2), so
      // the width snaps to 2.5 and the height stops at half a unit.
      dragBy(handle("se"), { x: 0.6, y: -5 });

      const committed = { height: 0.5, width: 2.5, x: 1, y: 1 };

      expect(calls.onResize).toHaveBeenCalledExactlyOnceWith("a", committed, {
        input: "pointer",
      });
      expect(lastDraft(calls)).toStrictEqual({
        from: boxes.a,
        handle: "se",
        key: "a",
        kind: "resize",
        to: committed,
      });
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("keep the se corner when the nw one is dragged", async () => {
      expect.hasAssertions();

      const calls = await mount();

      dragBy(handle("nw"), { x: -1.2, y: 0.7 });

      expect(calls.onResize).toHaveBeenCalledExactlyOnceWith(
        "a",
        { height: 1.5, width: 3, x: 0, y: 1.5 },
        { input: "pointer" }
      );
    });

    it("resize with the arrows, by the large step with Shift", async () => {
      expect.hasAssertions();

      const user = userEvent.setup();
      const calls = await mount();

      handle("se").focus();
      await user.keyboard("{ArrowRight}");

      expect(calls.onResize).toHaveBeenLastCalledWith(
        "a",
        { height: 2, width: 2.5, x: 1, y: 1 },
        { input: "keyboard" }
      );

      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

      expect(calls.onResize).toHaveBeenLastCalledWith(
        "a",
        { height: 4, width: 2.5, x: 1, y: 1 },
        { input: "keyboard" }
      );
      expect(calls.onResize).toHaveBeenCalledTimes(2);
      expect(calls.onMove).not.toHaveBeenCalled();
    });
  });
});
