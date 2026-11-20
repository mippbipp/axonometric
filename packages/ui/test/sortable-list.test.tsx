import {
  SortableList,
  SortableListHandle,
  SortableListItem,
} from "@axonometric/ui/components/sortable-list";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

type Change = (value: Array<string>, details: { reason: string }) => void;

const names = {
  a: "Alpha",
  b: "Bravo, proposed for deletion",
  c: "Charlie",
} as const satisfies Record<string, string>;

const initial = ["a", "b", "c"] as const;

function Rows({
  disabled = false,
  onChange,
  start = initial,
}: {
  readonly disabled?: boolean;
  readonly onChange: Change;
  readonly start?: ReadonlyArray<keyof typeof names>;
}) {
  const [value, setValue] = useState<Array<string>>([...start]);

  return (
    <SortableList
      aria-label="Letters"
      disabled={disabled}
      label={(key) => names[key as keyof typeof names]}
      onValueChange={(next, details) => {
        setValue(next);
        onChange(next, details);
      }}
      value={value}
    >
      {({ order }) =>
        order.map((key) => (
          <SortableListItem data-row={key} key={key} value={key}>
            <SortableListHandle
              aria-label={`Reorder ${names[key as keyof typeof names]}`}
              value={key}
            >
              ⠿
            </SortableListHandle>
            {names[key as keyof typeof names]}
          </SortableListItem>
        ))
      }
    </SortableList>
  );
}

const rowOrder = () =>
  [...document.querySelectorAll("[data-row]")].map(
    (row) => (row as HTMLElement).dataset.row
  );

const grip = (name: string) => screen.getByRole("button", { name });

const announced = () =>
  document.querySelector('[data-ui-sdk-announcer="assertive"]')?.textContent;

describe("sortable list", () => {
  it("renders an ordered list of rows, each grip a button", () => {
    expect.hasAssertions();

    render(<Rows onChange={vi.fn<Change>()} />);

    expect(screen.getByRole("list", { name: "Letters" }).tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    const alpha = grip("Reorder Alpha");

    expect(alpha.getAttribute("type")).toBe("button");
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    expect(alpha.className).toContain("touch-none");
  });

  it("renders the rows in the order it is given", () => {
    expect.hasAssertions();

    render(<Rows onChange={vi.fn<Change>()} start={["c", "a", "b"]} />);

    expect(rowOrder()).toStrictEqual(["c", "a", "b"]);
  });

  it("picks up with Space, moves with arrows and commits once on Space", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Alpha").focus();
    await user.keyboard(" ");

    expect(grip("Reorder Alpha").getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector<HTMLElement>('[data-row="a"]')?.dataset.grabbed
    ).toBe("");

    await user.keyboard("{ArrowDown}{ArrowDown}");

    expect(rowOrder()).toStrictEqual(["b", "c", "a"]);
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      ["b", "c", "a"],
      expect.objectContaining({ reason: "move-key" })
    );
  });

  it("clears the held state after a drop", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Rows onChange={vi.fn<Change>()} />);
    grip("Reorder Alpha").focus();
    await user.keyboard(" {ArrowDown} ");

    expect(grip("Reorder Alpha").getAttribute("aria-pressed")).toBe("false");
    expect(
      document.querySelector<HTMLElement>('[data-row="a"]')?.dataset.grabbed
    ).toBeUndefined();
  });

  it("picks up with Enter too", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Charlie").focus();
    await user.keyboard("{Enter}{ArrowUp}{Enter}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      ["a", "c", "b"],
      expect.objectContaining({ reason: "move-key" })
    );
  });

  it("puts the row back on Escape with no change", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Alpha").focus();
    await user.keyboard(" {ArrowDown}");

    expect(rowOrder()).toStrictEqual(["b", "a", "c"]);

    await user.keyboard("{Escape}");

    expect(rowOrder()).toStrictEqual(["a", "b", "c"]);
    expect(onChange).not.toHaveBeenCalled();
    expect(grip("Reorder Alpha").getAttribute("aria-pressed")).toBe("false");
  });

  it("puts the row back on Tab and moves on", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Alpha").focus();
    await user.keyboard(" {ArrowDown}{Tab}");

    expect(rowOrder()).toStrictEqual(["a", "b", "c"]);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      grip("Reorder Bravo, proposed for deletion")
    );
  });

  it("jumps to the ends with Home and End", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Bravo, proposed for deletion").focus();
    await user.keyboard(" {End}");

    expect(rowOrder()).toStrictEqual(["a", "c", "b"]);

    await user.keyboard("{Home}");

    expect(rowOrder()).toStrictEqual(["b", "a", "c"]);

    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      ["b", "a", "c"],
      expect.objectContaining({ reason: "move-key" })
    );
  });

  it("does not commit a drop that left the order alone", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows onChange={onChange} />);
    grip("Reorder Alpha").focus();
    await user.keyboard(" {ArrowUp} ");

    expect(onChange).not.toHaveBeenCalled();
    expect(rowOrder()).toStrictEqual(["a", "b", "c"]);
  });

  it("does not pick up while disabled", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<Change>();
    const user = userEvent.setup();

    render(<Rows disabled onChange={onChange} />);

    const alpha = grip("Reorder Alpha");

    expect(alpha).toHaveProperty("disabled", true);

    alpha.focus();
    await user.keyboard(" {ArrowDown} ");

    expect(rowOrder()).toStrictEqual(["a", "b", "c"]);
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("announces each step with the spoken label", async () => {
    expect.hasAssertions();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
      });

      render(<Rows onChange={vi.fn<Change>()} />);
      grip("Reorder Bravo, proposed for deletion").focus();

      await user.keyboard(" ");
      await act(() => vi.advanceTimersByTimeAsync(150));

      expect(announced()).toBe(
        "Picked up Bravo, proposed for deletion, position 2 of 3."
      );

      await user.keyboard("{ArrowDown}");
      await act(() => vi.advanceTimersByTimeAsync(150));

      expect(announced()).toBe(
        "Bravo, proposed for deletion, position 3 of 3."
      );

      await user.keyboard(" ");
      await act(() => vi.advanceTimersByTimeAsync(150));

      expect(announced()).toBe(
        "Dropped Bravo, proposed for deletion at position 3 of 3."
      );

      await act(settle);
    } finally {
      vi.useRealTimers();
    }
  });

  it("styles the held row with the data attribute ui-sdk sets", () => {
    expect.hasAssertions();

    render(<Rows onChange={vi.fn<Change>()} />);

    const row = document.querySelector<HTMLElement>('[data-row="a"]');

    expect(row?.className).toContain("data-[grabbed]:relative");
    expect(row?.className).toContain("var(--drag-x,0px)");
    expect(row?.dataset.slot).toBe("sortable-list-item");
  });
});
