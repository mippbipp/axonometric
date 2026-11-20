import {
  RovingList,
  RovingListItem,
} from "@axonometric/ui/components/roving-list";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { Array as Arr } from "effect";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const names = { a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta" } as const;

type Key = keyof typeof names;

function List({
  current = "b",
  keys = allKeys,
  loop,
  onClick,
  orientation,
}: {
  readonly current?: Key;
  readonly keys?: ReadonlyArray<Key>;
  readonly loop?: boolean;
  readonly onClick?: (key: Key) => void;
  readonly orientation?: "horizontal" | "vertical";
}) {
  return (
    <>
      <button type="button">before</button>
      <RovingList
        aria-label="Things"
        loop={loop}
        orientation={orientation}
        value={current}
      >
        {keys.map((key) => (
          <RovingListItem
            aria-current={key === current ? "true" : undefined}
            key={key}
            onClick={() => onClick?.(key)}
            value={key}
          >
            {names[key]}
          </RovingListItem>
        ))}
      </RovingList>
      <button type="button">after</button>
    </>
  );
}

const item = (key: Key) => screen.getByRole("button", { name: names[key] });

const stops = () =>
  Arr.flatMap([...document.querySelectorAll("nav button")], (el) =>
    el.getAttribute("tabindex") === "0" ? [el.textContent] : []
  );

const allKeys: ReadonlyArray<Key> = ["a", "b", "c", "d"];

function Harness() {
  const [current, setCurrent] = useState<Key>("a");

  return (
    <>
      <button
        onClick={() => {
          setCurrent("c");
        }}
        type="button"
      >
        pick c
      </button>
      <List current={current} />
    </>
  );
}

const handled = (event: KeyboardEvent) => {
  event.preventDefault();
};

const orientations = [
  {
    back: "ArrowUp",
    forward: "ArrowDown",
    orientation: "vertical",
    wrong: "ArrowRight",
  },
  {
    back: "ArrowLeft",
    forward: "ArrowRight",
    orientation: "horizontal",
    wrong: "ArrowDown",
  },
] as const;

describe("roving list", () => {
  it("renders a nav of buttons with no roles of its own", async () => {
    expect.hasAssertions();

    render(<List />);
    await settle();

    expect(screen.getByRole("navigation", { name: "Things" }).tagName).toBe(
      "NAV"
    );
    expect(document.querySelectorAll("[role]")).toHaveLength(0);
    expect(item("a").getAttribute("type")).toBe("button");
  });

  it("has one Tab stop, on the value item, and Tab leaves in one press", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<List />);
    await settle();

    expect(stops()).toStrictEqual(["Bravo"]);

    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();

    expect(document.activeElement).toBe(item("b"));

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "after" })
    );
  });

  it.each(orientations)(
    "moves focus with the $orientation arrows only",
    async ({ back, forward, orientation, wrong }) => {
      expect.hasAssertions();

      const user = userEvent.setup();

      render(<List orientation={orientation} />);
      await settle();

      act(() => {
        item("b").focus();
      });
      await user.keyboard(`{${forward}}`);

      expect(document.activeElement).toBe(item("c"));

      await user.keyboard(`{${back}}{${back}}`);

      expect(document.activeElement).toBe(item("a"));

      await user.keyboard(`{${wrong}}`);

      expect(document.activeElement).toBe(item("a"));
    }
  );

  it("stops at either end without loop", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<List />);
    await settle();

    act(() => {
      item("d").focus();
    });
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(item("d"));

    act(() => {
      item("a").focus();
    });
    await user.keyboard("{ArrowUp}");

    expect(document.activeElement).toBe(item("a"));
  });

  it("wraps past either end with loop", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<List loop />);
    await settle();

    act(() => {
      item("d").focus();
    });
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(item("a"));

    await user.keyboard("{ArrowUp}");

    expect(document.activeElement).toBe(item("d"));
  });

  it("moves to the first and last item with Home and End", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<List />);
    await settle();

    act(() => {
      item("b").focus();
    });
    await user.keyboard("{End}");

    expect(document.activeElement).toBe(item("d"));

    await user.keyboard("{Home}");

    expect(document.activeElement).toBe(item("a"));
  });

  it("gives the stop back to the value item when focus returns", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<List />);
    await settle();

    act(() => {
      item("b").focus();
    });
    await user.keyboard("{ArrowDown}{ArrowDown}");

    expect(document.activeElement).toBe(item("d"));

    await user.tab();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(item("b"));
    expect(stops()).toContain("Bravo");
    expect(stops()).not.toContain("Delta");
  });

  it("follows the value when it changes", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Harness />);
    await settle();

    expect(stops()).toContain("Alpha");

    await user.click(screen.getByRole("button", { name: "pick c" }));
    await settle();

    expect(stops()).toContain("Charlie");
    expect(stops()).not.toContain("Alpha");
  });

  it("moves focus to a neighbour when the focused item is removed", async () => {
    expect.hasAssertions();

    const { rerender } = render(<List />);
    await settle();

    act(() => {
      item("c").focus();
    });

    rerender(<List keys={["a", "b", "d"]} />);
    await settle();

    expect(document.activeElement).toBe(item("d"));
  });

  it("falls back to the last item when the last focused item is removed", async () => {
    expect.hasAssertions();

    const { rerender } = render(<List />);
    await settle();

    act(() => {
      item("d").focus();
    });

    rerender(<List keys={["a", "b", "c"]} />);
    await settle();

    expect(document.activeElement).toBe(item("c"));
  });

  it("ignores Alt+arrow and keys already handled", async () => {
    expect.hasAssertions();

    render(<List />);
    await settle();

    act(() => {
      item("b").focus();
    });
    fireEvent.keyDown(item("b"), { altKey: true, key: "ArrowDown" });

    expect(document.activeElement).toBe(item("b"));

    item("b").addEventListener("keydown", handled, { capture: true });
    fireEvent.keyDown(item("b"), { key: "ArrowDown" });
    item("b").removeEventListener("keydown", handled, { capture: true });

    expect(document.activeElement).toBe(item("b"));

    fireEvent.keyDown(item("b"), { key: "ArrowDown" });

    expect(document.activeElement).toBe(item("c"));
  });

  it("prevents the default of the arrows it uses", async () => {
    expect.hasAssertions();

    render(<List />);
    await settle();

    act(() => {
      item("b").focus();
    });

    expect(fireEvent.keyDown(item("b"), { key: "ArrowDown" })).toBeFalsy();
    expect(fireEvent.keyDown(item("c"), { key: "ArrowRight" })).toBeTruthy();
  });

  it("still fires onClick and keeps aria-current", async () => {
    expect.hasAssertions();

    const onClick = vi.fn<(key: Key) => void>();
    const user = userEvent.setup();

    render(<List onClick={onClick} />);
    await settle();
    await user.click(item("c"));

    expect(onClick).toHaveBeenCalledExactlyOnceWith("c");
    expect(item("b").getAttribute("aria-current")).toBe("true");
    expect(item("c").getAttribute("aria-current")).toBeNull();
  });

  it("fires onClick for Enter and Space on the focused item", async () => {
    expect.hasAssertions();

    const onClick = vi.fn<(key: Key) => void>();
    const user = userEvent.setup();

    render(<List onClick={onClick} />);
    await settle();

    act(() => {
      item("b").focus();
    });
    await user.keyboard("{ArrowDown}{Enter} ");

    expect(onClick.mock.calls).toStrictEqual([["c"], ["c"]]);
  });
});
