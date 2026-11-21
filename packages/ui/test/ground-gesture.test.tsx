import { GroundGesture } from "@axonometric/ui/components/ground-gesture";
import type {
  GroundGestureOptions,
  GroundStroke,
} from "@axonometric/ui/components/ground-gesture";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

interface Payload {
  readonly item: string;
}
type OnCommit = (stroke: GroundStroke<Payload>) => void;
type OnDraft = (stroke: GroundStroke<Payload> | null) => void;
type OnPress = (payload: Payload, event: MouseEvent) => void;

interface Calls {
  readonly onCommit: OnCommit;
  readonly onDraft: OnDraft;
  readonly onPress: OnPress;
}

const spies = (): Calls => ({
  onCommit: vi.fn<OnCommit>(),
  onDraft: vi.fn<OnDraft>(),
  onPress: vi.fn<OnPress>(),
});

/** Ten pixels to a ground unit, on both axes. */
const groundAt: GroundGestureOptions["groundAt"] = (_el, at) => ({
  x: at.clientX / 10,
  y: at.clientY / 10,
});

/**
 * A canvas with item a, which starts a stroke, and item b, which doesn't.
 * The gesture's own group is drawn beside them, so a press anywhere on the
 * canvas reaches it.
 */
function Canvas({
  calls,
  disabled = false,
}: {
  readonly calls: Calls;
  readonly disabled?: boolean;
}) {
  return (
    <div data-surface="">
      <svg>
        <rect data-item="a" height="10" width="10" />
        <rect data-item="b" height="10" width="10" />
        <GroundGesture
          data-testid="root"
          disabled={disabled}
          groundAt={groundAt}
          onCommit={(stroke) => {
            calls.onCommit(stroke);
          }}
          onDraft={(stroke) => {
            calls.onDraft(stroke);
          }}
          onPress={(payload, event) => {
            calls.onPress(payload, event);
          }}
          starts={(event: PointerEvent) => {
            const item =
              event.target instanceof Element
                ? event.target.closest<SVGElement>("[data-item]")?.dataset.item
                : undefined;

            return item === "a" ? { item } : undefined;
          }}
        />
      </svg>
    </div>
  );
}

const mount = async ({ disabled }: { readonly disabled?: boolean } = {}) => {
  const calls = spies();

  render(<Canvas calls={calls} disabled={disabled} />);
  await act(settle);

  return calls;
};

const item = (key: string) => {
  const el = document.querySelector<SVGElement>(`[data-item="${key}"]`);

  if (el === null) {
    throw new TypeError(`Item ${key} isn't mounted.`);
  }

  return el;
};

const pointer = (clientX: number, clientY: number) => ({
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  pointerId: 1,
  pointerType: "mouse",
});

/** Presses `el` at (20, 30), moves by `by` in pixels and lets go. */
const drag = (el: Element, [dx, dy]: readonly [number, number]) => {
  fireEvent.pointerDown(el, pointer(20, 30));
  fireEvent.pointerMove(document, pointer(20 + dx, 30 + dy));
  fireEvent.pointerUp(document, pointer(20 + dx, 30 + dy));
};

/** Clicks `el`, and counts the clicks that reached the canvas's parent. */
const clicksOnSurface = (el: Element) => {
  const surface = document.querySelector("[data-surface]");
  const onClick = vi.fn<() => void>();

  surface?.addEventListener("click", onClick);
  fireEvent.click(el);
  surface?.removeEventListener("click", onClick);

  return onClick.mock.calls.length;
};

describe("ground gesture", () => {
  it("does nothing for a press `starts` refuses, and leaves its click alone", async () => {
    expect.hasAssertions();

    const calls = await mount();

    drag(item("b"), [40, 0]);

    expect(calls.onDraft).not.toHaveBeenCalled();
    expect(calls.onCommit).not.toHaveBeenCalled();

    fireEvent.pointerDown(item("b"), pointer(20, 30));
    fireEvent.pointerUp(document, pointer(20, 30));

    expect(clicksOnSurface(item("b"))).toBe(1);
    expect(calls.onPress).not.toHaveBeenCalled();
  });

  it("drafts a press that moves 3 px along the ground, and commits it once with what `starts` gave", async () => {
    expect.hasAssertions();

    const calls = await mount();

    fireEvent.pointerDown(item("a"), pointer(20, 30));
    fireEvent.pointerMove(document, pointer(23, 30));

    await waitFor(() => {
      expect(calls.onDraft).toHaveBeenLastCalledWith({
        from: { x: 2, y: 3 },
        payload: { item: "a" },
        to: { x: 2.3, y: 3 },
      });
    });

    fireEvent.pointerMove(document, pointer(60, 10));
    fireEvent.pointerUp(document, pointer(60, 10));

    expect(calls.onCommit).toHaveBeenCalledExactlyOnceWith({
      from: { x: 2, y: 3 },
      payload: { item: "a" },
      to: { x: 6, y: 1 },
    });
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
  });

  it("swallows the click after a drag, so it presses nothing", async () => {
    expect.hasAssertions();

    const calls = await mount();

    drag(item("a"), [30, 0]);

    expect(clicksOnSurface(item("a"))).toBe(0);
    expect(calls.onPress).not.toHaveBeenCalled();
  });

  it("lets go on Escape and commits nothing", async () => {
    expect.hasAssertions();

    const calls = await mount();

    fireEvent.pointerDown(item("a"), pointer(20, 30));
    fireEvent.pointerMove(document, pointer(60, 30));

    await waitFor(() => {
      expect(calls.onDraft).toHaveBeenCalledWith(
        expect.objectContaining({ to: { x: 6, y: 3 } })
      );
    });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(document, pointer(60, 30));

    expect(calls.onCommit).not.toHaveBeenCalled();
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
  });

  it("keeps a press that moves 2 px a click, which `onPress` takes and no one above hears", async () => {
    expect.hasAssertions();

    const calls = await mount();

    drag(item("a"), [2, 2]);

    expect(calls.onDraft).not.toHaveBeenCalled();
    expect(clicksOnSurface(item("a"))).toBe(0);
    expect(calls.onPress).toHaveBeenCalledExactlyOnceWith(
      { item: "a" },
      expect.any(MouseEvent)
    );
    expect(calls.onCommit).not.toHaveBeenCalled();
  });

  it("starts nothing while disabled", async () => {
    expect.hasAssertions();

    const calls = await mount({ disabled: true });

    drag(item("a"), [40, 0]);

    expect(calls.onDraft).not.toHaveBeenCalled();
    expect(calls.onCommit).not.toHaveBeenCalled();
    expect(clicksOnSurface(item("a"))).toBe(1);
    expect(calls.onPress).not.toHaveBeenCalled();
  });
});
