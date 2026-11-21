import {
  ConnectPort,
  ConnectPorts,
} from "@axonometric/ui/components/connect-ports";
import type {
  ConnectDraft,
  ConnectPortsOptions,
} from "@axonometric/ui/components/connect-ports";
import { canvasDragging } from "@axonometric/ui/lib/canvas-drag";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

const ports = {
  "a:east": { structure: "a", x: 20, y: 50 },
  "b:north": { structure: "b", x: 150, y: 0 },
  "b:west": { structure: "b", x: 100, y: 50 },
  "c:north": { structure: "c", x: 20, y: 150 },
} as const;

type Port = keyof typeof ports;

const keys: ReadonlyArray<Port> = ["a:east", "b:north", "b:west", "c:north"];

const isPort = (key: string): key is Port => key in ports;

const structureOf = (key: string) =>
  isPort(key) ? ports[key].structure : undefined;

const placed = (el: SVGCircleElement | null, key: Port) => {
  if (el !== null) {
    const { x, y } = ports[key];

    el.getBoundingClientRect = () =>
      DOMRect.fromRect({ height: 10, width: 10, x: x - 5, y: y - 5 });
  }
};

type OnConnect = ConnectPortsOptions["onConnect"];
type OnDraft = (draft: ConnectDraft | null) => void;

interface Calls {
  readonly onConnect: OnConnect;
  readonly onDraft: OnDraft;
}

const spies = (): Calls => ({
  onConnect: vi.fn<OnConnect>(() => true),
  onDraft: vi.fn<OnDraft>(),
});

function Structures({
  calls,
  disabled = false,
  shown = true,
}: {
  readonly calls: Calls;
  readonly disabled?: boolean;
  readonly shown?: boolean;
}) {
  return (
    <>
      <input aria-label="Name" />
      <svg>
        {(["a", "b", "c"] as const).map((structure) => (
          <g data-structure={structure} key={structure} tabIndex={0}>
            <rect height="10" width="10" />
          </g>
        ))}
        {shown ? (
          <ConnectPorts
            canConnect={(from, to) => structureOf(from) !== structureOf(to)}
            data-testid="root"
            disabled={disabled}
            label={(key) => `Port ${key}`}
            message={(message, label) =>
              message.type === "start"
                ? `From ${label(message.from)}.`
                : message.type === "target"
                  ? `Aimed at ${label(message.to)}.`
                  : message.type === "connect"
                    ? `Joined ${label(message.from)} and ${label(message.to)}.`
                    : "Dropped."
            }
            onConnect={(from, to, details) =>
              calls.onConnect(from, to, details)
            }
            onDraft={(draft) => {
              calls.onDraft(draft);
            }}
            point={(_el, { clientX, clientY }) => ({ x: clientX, y: clientY })}
            sourceOf={(target) => {
              const structure =
                target.closest<SVGGElement>("[data-structure]")?.dataset
                  .structure;

              return structure === undefined
                ? null
                : `${structure}:${structure === "a" ? "east" : "north"}`;
            }}
            startKey="h"
            targetAt={({ x, y }) =>
              x < 90 ? null : y < 25 ? "b:north" : "b:west"
            }
          >
            {keys.map((key) => (
              <ConnectPort
                data-port={key}
                key={key}
                ref={(el) => {
                  placed(el, key);
                }}
                value={key}
              />
            ))}
          </ConnectPorts>
        ) : null}
      </svg>
    </>
  );
}

const mount = async (calls = spies()) => {
  const shown = render(<Structures calls={calls} />);

  await act(settle);

  return { ...shown, calls };
};

const pointer = (clientX: number, clientY: number) => ({
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  pointerId: 1,
  pointerType: "mouse",
});

const port = (key: Port) => {
  const el = document.querySelector<SVGCircleElement>(`[data-port="${key}"]`);

  if (el === null) {
    throw new TypeError(`Port ${key} isn't mounted.`);
  }

  return el;
};

const structure = (key: string) => {
  const el = document.querySelector<SVGGElement>(`[data-structure="${key}"]`);

  if (el === null) {
    throw new TypeError(`Structure ${key} isn't mounted.`);
  }

  return el;
};

const status = () => (canvasDragging() ? "dragging" : "idle");

const root = () => document.querySelector<SVGGElement>('[data-testid="root"]');

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

const keyDown = (key: string) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

const pressOn = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  if (el instanceof HTMLElement || el instanceof SVGElement) {
    el.focus();
  }

  fireEvent.keyDown(el, { key, ...init });
};

const startFromA = async () => {
  pressOn(structure("a"), "h");

  await waitFor(() => {
    expect(root()?.dataset.connecting).toBe("keyboard");
  });
};

const dragTo = async (to: { readonly x: number; readonly y: number }) => {
  fireEvent.pointerDown(port("a:east"), pointer(20, 50));
  fireEvent.pointerMove(document, pointer(to.x, to.y));

  await waitFor(() => {
    expect(root()?.dataset.connecting).toBe("pointer");
  });
};

describe("connect ports", () => {
  describe("from the keyboard", () => {
    it("starts from the focused structure's port on the start key, and says so", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await startFromA();
      await announcement();

      expect(announced()).toBe("From Port a:east.");
      expect(port("a:east").dataset.connect).toBe("source");
      expect(port("b:west").dataset.connect).toBe("candidate");
      expect(calls.onDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "a:east", keyboard: true, to: null })
      );
    });

    it("aims at the nearest port in an arrow's direction, and says which", async () => {
      expect.hasAssertions();

      await mount();
      await startFromA();
      keyDown("ArrowRight");
      await announcement();

      expect(port("b:west").dataset.connect).toBe("target");
      expect(announced()).toBe("Aimed at Port b:west.");

      keyDown("ArrowDown");

      expect(port("c:north").dataset.connect).toBe("target");
    });

    it("connects once on Enter, and says so", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await startFromA();
      keyDown("ArrowRight");
      keyDown("Enter");
      await announcement();

      expect(calls.onConnect).toHaveBeenCalledExactlyOnceWith(
        "a:east",
        "b:west",
        expect.objectContaining({ reason: "connect-key" })
      );
      expect(announced()).toBe("Joined Port a:east and Port b:west.");
      expect(root()?.dataset.connecting).toBeUndefined();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("keeps Enter with nothing aimed at from the focused structure", async () => {
      expect.hasAssertions();

      const { calls } = await mount();
      const onKeyDown = vi.fn<() => void>();

      await startFromA();
      structure("a").addEventListener("keydown", onKeyDown);
      fireEvent.keyDown(structure("a"), { key: "Enter" });
      structure("a").removeEventListener("keydown", onKeyDown);

      expect(calls.onConnect).not.toHaveBeenCalled();
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(root()?.dataset.connecting).toBe("keyboard");
    });

    it("lets go on Escape, which reaches nothing else, and says so", async () => {
      expect.hasAssertions();

      const { calls } = await mount();
      const onKeyDown = vi.fn<() => void>();

      await startFromA();
      globalThis.addEventListener("keydown", onKeyDown);
      keyDown("Escape");
      globalThis.removeEventListener("keydown", onKeyDown);
      await announcement();

      expect(onKeyDown).not.toHaveBeenCalled();
      expect(announced()).toBe("Dropped.");
      expect(calls.onConnect).not.toHaveBeenCalled();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("lets go on Tab", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await startFromA();
      keyDown("Tab");

      expect(root()?.dataset.connecting).toBeUndefined();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("lets go when a pointer presses anywhere", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await startFromA();
      fireEvent.pointerDown(structure("c"), pointer(0, 0));

      expect(root()?.dataset.connecting).toBeUndefined();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("leaves the start key alone in a field, with a modifier, or off a structure", async () => {
      expect.hasAssertions();

      const { calls, getByRole } = await mount();

      pressOn(getByRole("textbox", { name: "Name" }), "h");
      pressOn(structure("a"), "h", { ctrlKey: true });
      pressOn(structure("a"), "h", { altKey: true });
      pressOn(structure("a"), "h", { metaKey: true });
      pressOn(document.body, "h");

      expect(calls.onDraft).not.toHaveBeenCalled();
      expect(root()?.dataset.connecting).toBeUndefined();
    });
  });

  describe("with a pointer", () => {
    it("does nothing for a press that moves 2 px", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      fireEvent.pointerDown(port("a:east"), pointer(20, 50));
      fireEvent.pointerMove(document, pointer(22, 52));
      fireEvent.pointerUp(document, pointer(22, 52));

      expect(calls.onDraft).not.toHaveBeenCalled();
      expect(calls.onConnect).not.toHaveBeenCalled();
    });

    it("connects once to the port targetAt gives, however far from it, and says only that", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await dragTo({ x: 300, y: 10 });

      await waitFor(() => {
        expect(port("b:north").dataset.connect).toBe("target");
      });

      await announcement();

      expect(announced()).not.toContain("Aimed at");

      fireEvent.pointerUp(document, pointer(300, 10));
      await announcement();

      expect(calls.onConnect).toHaveBeenCalledExactlyOnceWith(
        "a:east",
        "b:north",
        expect.objectContaining({ reason: "drag" })
      );
      expect(announced()).toBe("Joined Port a:east and Port b:north.");
      expect(calls.onDraft).toHaveBeenCalledWith({
        from: "a:east",
        keyboard: false,
        to: "b:north",
        x: 300,
        y: 10,
      });
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("connects nothing when the drop is over no port", async () => {
      expect.hasAssertions();

      const { calls } = await mount();

      await dragTo({ x: 50, y: 50 });
      fireEvent.pointerUp(document, pointer(50, 50));

      expect(calls.onConnect).not.toHaveBeenCalled();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("connects nothing after Escape, which reaches nothing else", async () => {
      expect.hasAssertions();

      const { calls } = await mount();
      const onKeyDown = vi.fn<() => void>();

      globalThis.addEventListener("keydown", onKeyDown);
      await dragTo({ x: 300, y: 50 });
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.pointerUp(document, pointer(300, 50));
      globalThis.removeEventListener("keydown", onKeyDown);

      expect(onKeyDown).not.toHaveBeenCalled();
      expect(calls.onConnect).not.toHaveBeenCalled();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });
  });

  describe("while drawing", () => {
    it("counts as dragging from the keyboard and with a pointer, and not after", async () => {
      expect.hasAssertions();

      await mount();
      await startFromA();

      expect(status()).toBe("dragging");

      keyDown("Escape");

      expect(status()).toBe("idle");

      await dragTo({ x: 300, y: 50 });

      expect(status()).toBe("dragging");

      fireEvent.pointerUp(document, pointer(300, 50));

      expect(status()).toBe("idle");
    });

    it("lets go, and stops counting, when it unmounts mid-drag", async () => {
      expect.hasAssertions();

      const calls = spies();
      const { rerender } = render(<Structures calls={calls} />);

      await act(settle);
      await dragTo({ x: 300, y: 50 });
      rerender(<Structures calls={calls} shown={false} />);
      await act(settle);
      fireEvent.pointerUp(document, pointer(300, 50));

      expect(status()).toBe("idle");
      expect(calls.onConnect).not.toHaveBeenCalled();
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });

    it("lets go, and stops counting, when it unmounts mid-draft from the keyboard", async () => {
      expect.hasAssertions();

      const calls = spies();
      const { rerender } = render(<Structures calls={calls} />);

      await act(settle);
      await startFromA();
      rerender(<Structures calls={calls} shown={false} />);
      await act(settle);

      expect(status()).toBe("idle");
      expect(calls.onDraft).toHaveBeenLastCalledWith(null);
    });
  });

  it("ignores presses and the start key while disabled, and lets go of a draft", async () => {
    expect.hasAssertions();

    const calls = spies();
    const { rerender } = render(<Structures calls={calls} />);

    await act(settle);
    await startFromA();
    rerender(<Structures calls={calls} disabled />);
    await act(settle);

    expect(root()?.dataset.connecting).toBeUndefined();

    pressOn(structure("a"), "h");
    fireEvent.pointerDown(port("a:east"), pointer(20, 50));
    fireEvent.pointerMove(document, pointer(300, 50));
    fireEvent.pointerUp(document, pointer(300, 50));

    expect(root()?.dataset.connecting).toBeUndefined();
    expect(calls.onConnect).not.toHaveBeenCalled();
    expect(calls.onDraft).toHaveBeenLastCalledWith(null);
  });
});
