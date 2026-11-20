import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@axonometric/ui/components/toolbar";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

function Edits({
  onUndo,
  orientation,
}: {
  readonly onUndo?: () => void;
  readonly orientation?: "horizontal" | "vertical";
}) {
  return (
    <Toolbar aria-label="Edit" orientation={orientation}>
      <ToolbarButton onClick={onUndo}>Undo</ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton disabled>Redo</ToolbarButton>
      <ToolbarButton>Group</ToolbarButton>
    </Toolbar>
  );
}

describe("toolbar", () => {
  it("is one Tab stop, and the arrow keys move over its buttons", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(
      <>
        <Edits />
        <button type="button">After</button>
      </>
    );
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo" })
    );

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Redo" })
    );

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "After" })
    );
  });

  it("moves with the vertical arrows when it is vertical", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Edits orientation="vertical" />);
    await user.tab();
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Redo" })
    );
    expect(screen.getByRole("toolbar").className).toContain(
      "data-[orientation=vertical]:flex-col"
    );
  });

  it("keeps a disabled button reachable, announced and inert", async () => {
    expect.hasAssertions();

    const onUndo = vi.fn<() => void>();
    const user = userEvent.setup();

    render(<Edits onUndo={onUndo} />);

    const redo = screen.getByRole("button", { name: "Redo" });

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(redo);
    expect(redo.getAttribute("aria-disabled")).toBe("true");
    expect(redo.className).toContain("aria-disabled:opacity-50");

    await user.keyboard("{Enter}");

    expect(onUndo).not.toHaveBeenCalled();
  });

  it("styles a button as a Button, and runs its click", async () => {
    expect.hasAssertions();

    const onUndo = vi.fn<() => void>();
    const user = userEvent.setup();

    render(<Edits onUndo={onUndo} />);

    const undo = screen.getByRole("button", { name: "Undo" });

    expect(undo.className).toContain("border-border");

    await user.click(undo);
    await user.click(undo);

    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it("draws its separator as a rule", () => {
    expect.hasAssertions();

    render(<Edits />);

    expect(screen.getByRole("separator").className).toContain(
      "data-[orientation=horizontal]:w-px"
    );
  });

  it("follows the WAI-ARIA toolbar pattern", async () => {
    expect.hasAssertions();

    render(<Edits />);
    await act(settle);

    await expect(
      checkPattern(screen.getByRole("toolbar"), "toolbar")
    ).resolves.toBeUndefined();
  });
});
