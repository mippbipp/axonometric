import {
  PannableCanvas,
  usePannableCanvas,
} from "@axonometric/ui/components/pannable-canvas";
import type {
  Camera,
  CameraDetails,
  PannableCanvasApi,
} from "@axonometric/ui/components/pannable-canvas";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

const fitted: Camera = { x: 10, y: 20, zoom: 1.5 };

type CameraChange = (camera: Camera, details: CameraDetails) => void;

const seen: Array<PannableCanvasApi> = [];

function Reader() {
  seen.push(usePannableCanvas());

  return <text>reader</text>;
}

function Canvas({
  api,
  onCameraChange,
  onClick,
}: {
  readonly api?: React.Ref<PannableCanvasApi>;
  readonly onCameraChange?: CameraChange;
  readonly onClick?: () => void;
}) {
  return (
    <PannableCanvas
      claims={(event) =>
        event.shiftKey ||
        (event.target instanceof Element &&
          event.target.closest("[data-claimed]") !== null)
      }
      controls={
        <button data-controls-button="" type="button">
          Zoom in
        </button>
      }
      fit={() => fitted}
      limits={(fitScale) => ({ max: fitScale * 4, min: fitScale / 2 })}
      onCameraChange={onCameraChange}
      ref={api}
      title="Test map"
    >
      <rect data-empty="" height="10" width="10" />
      <rect
        data-claimed=""
        height="10"
        onClick={() => onClick?.()}
        width="10"
      />
      <rect data-plain="" height="10" onClick={() => onClick?.()} width="10" />
      <Reader />
    </PannableCanvas>
  );
}

const find = (selector: string) => {
  const found = document.querySelector(selector);

  if (!(found instanceof SVGElement || found instanceof HTMLElement)) {
    throw new TypeError(`Nothing matches ${selector}.`);
  }

  return found;
};

const svg = () => find("svg");

const world = () => find("[data-viewport]");

const scale = () => Number(svg().dataset.scale);

const translation = () => {
  const match = /translate\((?<x>[-\d.e]+)px,\s*(?<y>[-\d.e]+)px\)/u.exec(
    world().style.transform
  );

  return { x: Number(match?.groups?.x), y: Number(match?.groups?.y) };
};

interface PointerExtras {
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly shiftKey?: boolean;
}

const mouse = (extra: PointerExtras = {}) => ({
  button: 0,
  pointerId: 1,
  pointerType: "mouse",
  ...extra,
});

const drag = (
  target: Element,
  [dx, dy]: readonly [number, number],
  extra: PointerExtras = {}
) => {
  fireEvent.pointerDown(
    target,
    mouse({ clientX: 100, clientY: 100, ...extra })
  );
  fireEvent.pointerMove(
    target,
    mouse({ clientX: 100 + dx, clientY: 100 + dy, ...extra })
  );
  fireEvent.pointerUp(
    target,
    mouse({ clientX: 100 + dx, clientY: 100 + dy, ...extra })
  );
};

const touch = (pointerId: number, clientX: number) => ({
  clientX,
  clientY: 100,
  pointerId,
  pointerType: "touch",
});

const preventDefault = (event: Event) => {
  event.preventDefault();
};

const announced = () =>
  document.querySelector('[data-ui-sdk-announcer=""]')?.textContent;

const apiOf = (ref: React.RefObject<PannableCanvasApi | null>) => {
  if (ref.current === null) {
    throw new TypeError("The canvas isn't mounted.");
  }

  return ref.current;
};

const fit = (api: React.RefObject<PannableCanvasApi | null>) => {
  act(() => {
    api.current?.fit();
  });
};

const mount = (props: Parameters<typeof Canvas>[0] = {}) => {
  const api = createRef<PannableCanvasApi>();

  render(<Canvas api={api} {...props} />);
  fit(api);

  return api;
};

describe("pannable canvas", () => {
  it("draws the svg, the world and the controls in the documented tree", () => {
    expect.hasAssertions();

    mount();

    expect(
      screen.getByRole("button", { name: "Zoom in" }).closest("[data-slot]")
    ).not.toBe(svg());
    expect(svg().getAttribute("aria-labelledby")).toBe(
      svg().querySelector("title")?.id
    );
    expect(svg().querySelector("title")?.textContent).toBe("Test map");
    expect(svg().querySelector("g g")).toBe(world());
    expect(world().getAttribute("style")).toContain("scale(1.5)");
  });

  it("writes the zoom on the svg", () => {
    expect.hasAssertions();

    mount();

    expect(scale()).toBe(1.5);
  });

  it("gives content the canvas's api", () => {
    expect.hasAssertions();

    const api = mount();

    expect(seen.at(-1)).toBe(api.current);
  });

  it("shows what fit returns and measures the zoom limits from it", () => {
    expect.hasAssertions();

    const api = mount();

    expect(api.current?.viewport.get()).toStrictEqual(fitted);
    expect(api.current?.fitScale()).toBe(1.5);

    act(() => {
      api.current?.viewport.zoomBy(100);
    });

    expect(scale()).toBe(6);

    act(() => {
      api.current?.viewport.zoomBy(0.0001);
    });

    expect(scale()).toBe(0.75);
  });

  it("reframes to a camera and the scale its limits are measured from", () => {
    expect.hasAssertions();

    const api = mount();

    act(() => {
      api.current?.reframe({ x: 1, y: 2, zoom: 3 }, 2);
    });

    expect(api.current?.viewport.get()).toStrictEqual({ x: 1, y: 2, zoom: 3 });
    expect(api.current?.fitScale()).toBe(2);

    act(() => {
      api.current?.viewport.zoomBy(100);
    });

    expect(scale()).toBe(8);
  });

  describe("pressing", () => {
    it("doesn't pan a press that moves 2 px along each axis, and its click lands", () => {
      expect.hasAssertions();

      const onClick = vi.fn<() => void>();

      mount({ onClick });

      const before = translation();
      const target = find("[data-plain]");

      drag(target, [2, 2]);
      fireEvent.click(target);

      expect(translation()).toStrictEqual(before);
      expect(onClick).toHaveBeenCalledExactlyOnceWith();
    });

    it("pans exactly 3 px for a press that moves 3 px along one axis, and swallows its click", () => {
      expect.hasAssertions();

      const onClick = vi.fn<() => void>();

      mount({ onClick });

      const before = translation();
      const target = find("[data-plain]");

      drag(target, [3, 0]);
      fireEvent.click(target);

      expect(translation()).toStrictEqual({ x: before.x + 3, y: before.y });
      expect(onClick).not.toHaveBeenCalled();
    });

    it("pans by the pointer's offset from the press", () => {
      expect.hasAssertions();

      mount();

      const before = translation();

      drag(find("[data-empty]"), [30, -12]);

      const after = translation();

      expect(after.x - before.x).toBe(30);
      expect(after.y - before.y).toBe(-12);
    });

    it("keeps panning from the press as the pointer moves on", () => {
      expect.hasAssertions();

      mount();

      const before = translation();
      const target = find("[data-empty]");

      fireEvent.pointerDown(target, mouse({ clientX: 100, clientY: 100 }));
      fireEvent.pointerMove(target, mouse({ clientX: 110, clientY: 100 }));
      fireEvent.pointerMove(target, mouse({ clientX: 140, clientY: 100 }));
      fireEvent.pointerUp(target, mouse({ clientX: 140, clientY: 100 }));

      expect(translation().x - before.x).toBe(40);
    });

    it("doesn't pan a press `claims` takes, such as on a target or with Shift, nor a right button", () => {
      expect.hasAssertions();

      mount();

      const before = translation();

      drag(find("[data-empty]"), [40, 0], {
        shiftKey: true,
      });
      drag(find("[data-empty]"), [40, 0], {
        button: 2,
      });
      drag(find("[data-claimed]"), [40, 0]);

      expect(translation()).toStrictEqual(before);
    });

    it("doesn't pan from a press on the controls", () => {
      expect.hasAssertions();

      mount();

      const before = translation();

      drag(screen.getByRole("button", { name: "Zoom in" }), [40, 0]);

      expect(translation()).toStrictEqual(before);
    });

    it("swallows the click that ends a mouse pan, and only that one", () => {
      expect.hasAssertions();

      const onClick = vi.fn<() => void>();

      mount({ onClick });

      const target = find("[data-plain]");

      drag(find("[data-empty]"), [30, 0]);
      fireEvent.click(target);

      expect(onClick).not.toHaveBeenCalled();

      fireEvent.pointerDown(target, mouse());
      fireEvent.pointerUp(target, mouse());
      fireEvent.click(target);

      expect(onClick).toHaveBeenCalledExactlyOnceWith();
    });

    it("lets the next click land after a touch pan", () => {
      expect.hasAssertions();

      const onClick = vi.fn<() => void>();

      mount({ onClick });

      const before = translation();
      const target = find("[data-plain]");

      drag(find("[data-empty]"), [30, 0], {
        pointerType: "touch",
      });

      expect(translation().x - before.x).toBe(30);

      fireEvent.click(target);

      expect(onClick).toHaveBeenCalledExactlyOnceWith();
    });

    it("pinches with a second pointer", () => {
      expect.hasAssertions();

      mount();

      const target = find("[data-empty]");
      fireEvent.pointerDown(target, touch(1, 100));
      fireEvent.pointerDown(target, touch(2, 200));
      fireEvent.pointerMove(target, touch(2, 300));

      expect(scale()).toBeCloseTo(3, 5);
    });

    it("pinches when the first finger lands on the content", () => {
      expect.hasAssertions();

      mount();

      const claimed = find("[data-claimed]");

      fireEvent.pointerDown(claimed, touch(1, 100));
      fireEvent.pointerDown(find("[data-empty]"), touch(2, 200));
      fireEvent.pointerMove(claimed, touch(2, 300));

      expect(scale()).toBeCloseTo(3, 5);
    });

    it("pinches when `claims` took the first press for its key", () => {
      expect.hasAssertions();

      mount();

      const target = find("[data-empty]");

      fireEvent.pointerDown(target, { ...touch(1, 100), shiftKey: true });
      fireEvent.pointerDown(target, touch(2, 200));
      fireEvent.pointerMove(target, touch(2, 300));

      expect(scale()).toBeCloseTo(3, 5);
    });

    it("leaves a single press on the content to the content", () => {
      expect.hasAssertions();

      mount();

      const before = translation();
      const claimed = find("[data-claimed]");

      fireEvent.pointerDown(claimed, mouse({ clientX: 100, clientY: 100 }));
      fireEvent.pointerMove(claimed, mouse({ clientX: 160, clientY: 100 }));
      fireEvent.pointerUp(claimed, mouse({ clientX: 160, clientY: 100 }));

      expect(translation()).toStrictEqual(before);
    });
  });

  describe("wheel", () => {
    it("leaves the map alone over the controls", () => {
      expect.hasAssertions();

      mount();

      const before = scale();

      fireEvent.wheel(find("[data-controls-button]"), { deltaY: -300 });

      expect(scale()).toBe(before);
    });

    it("zooms with a plain wheel, and stops at the limits", () => {
      expect.hasAssertions();

      mount();

      fireEvent.wheel(svg(), { clientX: 0, clientY: 0, deltaY: -100 });

      expect(scale()).toBeCloseTo(1.5 * Math.exp(0.15), 5);

      fireEvent.wheel(svg(), { deltaY: -100_000 });

      expect(scale()).toBe(6);

      fireEvent.wheel(svg(), { deltaY: 100_000 });

      expect(scale()).toBe(0.75);
    });

    it("zooms with Ctrl and the wheel", () => {
      expect.hasAssertions();

      mount();

      fireEvent.wheel(svg(), { ctrlKey: true, deltaY: -20 });

      expect(scale()).toBeCloseTo(1.5 * Math.exp(0.2), 5);

      // ui-sdk caps one Ctrl and wheel turn at a delta of 50.
      fireEvent.wheel(svg(), { ctrlKey: true, deltaY: -100_000 });

      expect(scale()).toBeCloseTo(1.5 * Math.exp(0.2) * Math.exp(0.5), 5);

      for (let turn = 0; turn < 10; turn += 1) {
        fireEvent.wheel(svg(), { ctrlKey: true, deltaY: -100_000 });
      }

      expect(scale()).toBe(6);
    });

    it("keeps the point under the pointer still, in the canvas's own pixels", () => {
      expect.hasAssertions();

      const api = mount();

      const before = apiOf(api).viewport.toCanvas(40, 30);

      fireEvent.wheel(svg(), { clientX: 40, clientY: 30, deltaY: -100 });

      const after = apiOf(api).viewport.toCanvas(40, 30);

      expect(scale()).toBeGreaterThan(1.5);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    });

    it("stops the page scrolling", () => {
      expect.hasAssertions();

      mount();

      const outcomes = [
        fireEvent.wheel(svg(), { deltaY: -10 }),
        fireEvent.wheel(svg(), { ctrlKey: true, deltaY: -10 }),
      ];

      expect(outcomes).toStrictEqual([false, false]);
    });
  });

  describe("keys", () => {
    it("zooms with + and - by ui-sdk's steps, and announces it", async () => {
      expect.hasAssertions();

      mount();

      fireEvent.keyDown(document.body, { key: "+" });

      expect(scale()).toBeCloseTo(1.5 * 1.25, 5);

      fireEvent.keyDown(document.body, { key: "-" });

      expect(scale()).toBeCloseTo(1.5, 5);
      await waitFor(() => {
        expect(announced()).toBe("Zoom 150%");
      });
    });

    it("fits again with 0", () => {
      expect.hasAssertions();

      mount();

      const fittedAt = translation();

      fireEvent.wheel(svg(), { clientX: 50, clientY: 50, deltaY: -300 });
      drag(find("[data-empty]"), [30, 0]);

      expect(scale()).toBeGreaterThan(1.5);

      fireEvent.keyDown(document.body, { key: "0" });

      expect(scale()).toBe(1.5);
      expect(translation()).toStrictEqual(fittedAt);
    });

    it.each([
      ["Ctrl", { ctrlKey: true }],
      ["Meta", { metaKey: true }],
      ["Alt", { altKey: true }],
    ])("ignores + with %s held", (_name, modifier) => {
      expect.hasAssertions();

      mount();
      fireEvent.keyDown(document.body, { key: "+", ...modifier });

      expect(scale()).toBe(1.5);
    });

    it("ignores keys typed into a field", () => {
      expect.hasAssertions();

      mount();

      const field = document.createElement("input");

      document.body.append(field);
      fireEvent.keyDown(field, { key: "+" });
      fireEvent.keyDown(field, { key: "0" });
      field.remove();

      expect(scale()).toBe(1.5);
    });

    it("ignores a key a handler already took", () => {
      expect.hasAssertions();

      mount();

      document.body.addEventListener("keydown", preventDefault);
      fireEvent.keyDown(document.body, { key: "+" });
      document.body.removeEventListener("keydown", preventDefault);

      expect(scale()).toBe(1.5);
    });

    it("stops listening once it leaves the page", () => {
      expect.hasAssertions();

      const onCameraChange = vi.fn<CameraChange>();
      const api = createRef<PannableCanvasApi>();
      const { unmount } = render(
        <Canvas api={api} onCameraChange={onCameraChange} />
      );

      fit(api);
      fireEvent.keyDown(document.body, { key: "+" });

      expect(onCameraChange).toHaveBeenCalledTimes(2);

      unmount();
      fireEvent.keyDown(document.body, { key: "+" });

      expect(onCameraChange).toHaveBeenCalledTimes(2);
    });
  });

  describe("reasons", () => {
    it("reports why the camera moved", () => {
      expect.hasAssertions();

      const onCameraChange = vi.fn<CameraChange>();
      const api = mount({ onCameraChange });

      const reasons = () =>
        onCameraChange.mock.calls.map(([, details]) => details.reason);

      expect(reasons()).toStrictEqual(["imperative"]);

      fireEvent.wheel(svg(), { deltaY: -100 });
      fireEvent.wheel(svg(), { ctrlKey: true, deltaY: -100 });
      fireEvent.keyDown(document.body, { key: "+" });
      fireEvent.keyDown(document.body, { key: "0" });
      drag(find("[data-empty]"), [30, 0]);

      act(() => {
        api.current?.fit({ reason: "zoom-key" });
      });

      expect(reasons()).toStrictEqual([
        "imperative",
        "wheel",
        "wheel",
        "zoom-key",
        "zoom-key",
        "drag",
        "zoom-key",
      ]);
    });

    it("hears the camera it was given", () => {
      expect.hasAssertions();

      const onCameraChange = vi.fn<CameraChange>();

      mount({ onCameraChange });

      expect(onCameraChange).toHaveBeenCalledExactlyOnceWith(fitted, {
        reason: "imperative",
      });
    });
  });
});
