import { Toggle } from "@axonometric/ui/components/toggle";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@axonometric/ui/components/toolbar";
import { toggleVariants } from "@axonometric/ui/lib/toggle-variants";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Controlled({ onChange }: { readonly onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(false);

  return (
    <Toggle
      onPressedChange={(next) => {
        setOn(next);
        onChange(next);
      }}
      pressed={on}
    >
      Edit
    </Toggle>
  );
}

function Edits({ noteDisabled = false }: { readonly noteDisabled?: boolean }) {
  return (
    <Toolbar aria-label="Edit">
      <ToolbarButton>Undo</ToolbarButton>
      <ToolbarSeparator />
      <Toggle>Structure</Toggle>
      <Toggle disabled={noteDisabled}>Note</Toggle>
      <Toggle>Group</Toggle>
    </Toolbar>
  );
}

describe("toggle", () => {
  it("announces its pressed state and follows a controlled value", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: boolean) => void>();
    const user = userEvent.setup();

    render(<Controlled onChange={onChange} />);

    const edit = screen.getByRole("button", { name: "Edit" });

    expect(edit.getAttribute("aria-pressed")).toBe("false");

    await user.click(edit);

    expect(edit.getAttribute("aria-pressed")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith(true);

    await user.keyboard(" ");

    expect(edit.getAttribute("aria-pressed")).toBe("false");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("presses with Enter and never submits a form", async () => {
    expect.hasAssertions();

    const onSubmit = vi.fn<() => void>();
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <Toggle>Edit</Toggle>
      </form>
    );
    await user.tab();
    await user.keyboard("{Enter}");

    const edit = screen.getByRole("button", { name: "Edit" });

    expect(edit.getAttribute("aria-pressed")).toBe("true");
    expect(edit.getAttribute("type")).toBe("button");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("styles the pressed state with the data attribute ui-sdk sets", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Toggle>Edit</Toggle>);

    const edit = screen.getByRole("button", { name: "Edit" });

    expect(edit.className).toContain("data-[pressed]:bg-muted");
    expect(edit.dataset.pressed).toBeUndefined();

    await user.click(edit);

    expect(edit.dataset.pressed).toBe("");
  });

  it("does nothing while disabled, and leaves the tab order", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: boolean) => void>();
    const user = userEvent.setup();

    render(
      <Toggle disabled onPressedChange={onChange}>
        Edit
      </Toggle>
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("takes extra classes after the variant's", () => {
    expect.hasAssertions();

    render(
      <Toggle className="w-full" size="xs">
        Edit
      </Toggle>
    );

    const { className } = screen.getByRole("button", { name: "Edit" });

    expect(className).toContain("w-full");
    expect(className).toContain("h-6");
    expect(toggleVariants({ variant: "outline" })).toContain("border-input");
  });
});

describe("toolbar over stand-alone toggles", () => {
  it("is one Tab stop, and the arrow keys move over buttons and toggles", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Edits />);

    expect(screen.getAllByRole("toolbar", { name: "Edit" })).toHaveLength(1);

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo" })
    );

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Structure" })
    );

    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Group" })
    );

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Undo" })
    );
  });

  it("leaves the toolbar on one Tab, and wraps left to the end", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Edits />);
    await user.tab();
    await user.keyboard("{ArrowLeft}");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Group" })
    );

    await user.tab();

    expect(document.activeElement).toBe(document.body);
  });

  it("presses the focused toggle with Space and leaves the others", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Edits />);
    await user.tab();
    await user.keyboard("{ArrowRight} ");

    expect(
      screen
        .getByRole("button", { name: "Structure" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Note" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("keeps a disabled toggle reachable by arrow keys and doesn't press it", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Edits noteDisabled />);
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    const note = screen.getByRole("button", { name: "Note" });

    expect(document.activeElement).toBe(note);
    expect(note.getAttribute("aria-disabled")).toBe("true");

    await user.keyboard(" ");

    expect(note.getAttribute("aria-pressed")).toBe("false");
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
