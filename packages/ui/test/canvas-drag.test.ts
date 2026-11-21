import { bindCanvasDrag } from "@axonometric/ui/lib/canvas-drag";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type Handlers = Parameters<typeof bindCanvasDrag>[2];
type Move = Handlers["onMove"];
type End = Handlers["onEnd"];

const svgNs = "http://www.w3.org/2000/svg";

const mount = (tag: "div" | "line") => {
  const el =
    tag === "line"
      ? document.createElementNS(svgNs, "line")
      : document.createElement("div");

  const capture = vi.fn<(id: number) => void>();

  // jsdom has no pointer capture, so the element gets stand-ins.
  Object.assign(el, {
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    setPointerCapture: capture,
  });
  document.body.append(el);

  return Object.assign(el, { capture });
};

const pointer = (clientX: number, clientY = 100) => ({
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  pointerId: 1,
  pointerType: "mouse",
});

/** Presses at (100, 100) and starts a drag on the pressed element. */
const press = (el: Element, handlers: Handlers) => {
  let down: PointerEvent | undefined;

  el.addEventListener(
    "pointerdown",
    (event) => {
      down = event as PointerEvent;
    },
    { once: true }
  );
  fireEvent.pointerDown(el, pointer(100));

  if (down === undefined) {
    throw new TypeError("The press never reached the element.");
  }

  return bindCanvasDrag(el, down, handlers);
};

const clickAfter = (travel: number) => {
  const el = mount("div");
  const onClick = vi.fn<() => void>();

  document.body.addEventListener("click", onClick);
  press(el, { onEnd: vi.fn<End>(), onMove: vi.fn<Move>() });
  fireEvent.pointerMove(document, pointer(100 + travel));
  fireEvent.pointerUp(document, pointer(100 + travel));
  fireEvent.click(el);
  document.body.removeEventListener("click", onClick);

  return onClick;
};

describe("dragging on the canvas", () => {
  it("reports nothing until the pointer moves 3 px", () => {
    const el = mount("div");
    const onMove = vi.fn<Move>();
    const onStart = vi.fn<() => void>();
    const onEnd = vi.fn<End>();

    press(el, { onEnd, onMove, onStart });
    fireEvent.pointerMove(document, pointer(102));

    expect(onStart).not.toHaveBeenCalled();

    fireEvent.pointerUp(document, pointer(102));

    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({ canceled: false });
  });

  it("starts, then reports the pointer's window position and the end", async () => {
    const el = mount("div");
    const onMove = vi.fn<Move>();
    const onStart = vi.fn<() => void>();
    const onEnd = vi.fn<End>();

    press(el, { onEnd, onMove, onStart });
    fireEvent.pointerMove(document, pointer(110, 104));

    expect(onStart).toHaveBeenCalledWith();
    await waitFor(() => {
      expect(onMove).toHaveBeenLastCalledWith({ clientX: 110, clientY: 104 });
    });
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(document, pointer(110, 104));

    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ canceled: false });
  });

  it("captures the pointer once the drag starts", () => {
    const el = mount("div");

    press(el, { onEnd: vi.fn<End>(), onMove: vi.fn<Move>() });

    expect(el.capture).not.toHaveBeenCalled();

    fireEvent.pointerMove(document, pointer(110));

    expect(el.capture).toHaveBeenCalledWith(1);
  });

  it("cancels on Escape without the key reaching anything above", () => {
    const el = mount("div");
    const onEnd = vi.fn<End>();
    const above = vi.fn<() => void>();

    document.body.addEventListener("keydown", above);
    press(el, { onEnd, onMove: vi.fn<Move>() });
    fireEvent.pointerMove(document, pointer(110));
    fireEvent.keyDown(el, { key: "Escape" });
    document.body.removeEventListener("keydown", above);

    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ canceled: true });
    expect(above).not.toHaveBeenCalled();

    fireEvent.pointerUp(document, pointer(110));
  });

  it("ends canceled when the browser takes the pointer", () => {
    const el = mount("div");
    const onEnd = vi.fn<End>();

    press(el, { onEnd, onMove: vi.fn<Move>() });
    fireEvent.pointerMove(document, pointer(110));
    fireEvent.pointerCancel(document, pointer(110));

    expect(onEnd).toHaveBeenCalledWith({ canceled: true });
  });

  it("ends quietly when stopped", () => {
    const el = mount("div");
    const onEnd = vi.fn<End>();
    const onMove = vi.fn<Move>();
    const stop = press(el, { onEnd, onMove });

    fireEvent.pointerMove(document, pointer(110));
    stop();
    fireEvent.pointerMove(document, pointer(120));
    fireEvent.pointerUp(document, pointer(120));

    expect(onEnd).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  describe("the click that follows", () => {
    it("is swallowed after a drag past the threshold", () => {
      expect(clickAfter(10)).not.toHaveBeenCalled();
    });

    it("is kept for a press that stayed under it", () => {
      expect(clickAfter(1)).toHaveBeenCalledWith(expect.anything());
    });
  });

  it("drags an SVG element", async () => {
    const el = mount("line");
    const onMove = vi.fn<Move>();
    const onEnd = vi.fn<End>();

    press(el, { onEnd, onMove });
    fireEvent.pointerMove(document, pointer(120));
    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith({ clientX: 120, clientY: 100 });
    });
    fireEvent.pointerUp(document, pointer(120));

    expect(el.capture).toHaveBeenCalledWith(1);
    expect(onEnd).toHaveBeenCalledWith({ canceled: false });
  });
});
