import { Checkbox } from "@axonometric/ui/components/checkbox";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Priority({
  disabled = false,
  onChange,
}: {
  readonly disabled?: boolean;
  readonly onChange?: (next: boolean) => void;
}) {
  const [priority, setPriority] = useState(false);

  return (
    <label htmlFor="priority">
      <Checkbox
        checked={priority}
        disabled={disabled}
        id="priority"
        onCheckedChange={(next) => {
          setPriority(next === true);
          onChange?.(next === true);
        }}
      />
      <span>Priority boarding</span>
    </label>
  );
}

const checked = () =>
  screen
    .getByRole("checkbox", { name: "Priority boarding" })
    .getAttribute("aria-checked");

describe("checkbox", () => {
  it("is named by the label around it and follows a controlled value", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(next: boolean) => void>();
    const user = userEvent.setup();

    render(<Priority onChange={onChange} />);

    expect(checked()).toBe("false");

    await user.click(screen.getByText("Priority boarding"));

    expect(checked()).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("checkbox"));

    expect(checked()).toBe("false");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("is one Tab stop and toggles with Space", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Priority />);
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole("checkbox"));

    await user.keyboard(" ");

    expect(checked()).toBe("true");
  });

  it("shows its mark only while checked, styled by ui-sdk's data attribute", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Priority />);

    const box = screen.getByRole("checkbox");

    expect(box.textContent).toBe("");
    expect(box.className).toContain("data-[checked]:bg-primary");
    expect(box.dataset.checked).toBeUndefined();

    await user.click(box);

    expect(box.textContent).toBe("✓");
    expect(box.dataset.checked).toBe("");
  });

  it("does nothing while disabled", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(next: boolean) => void>();
    const user = userEvent.setup();

    render(<Priority disabled onChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));

    expect(onChange).not.toHaveBeenCalled();
    expect(checked()).toBe("false");
  });

  it("follows the WAI-ARIA checkbox pattern", async () => {
    expect.hasAssertions();

    render(<Priority />);
    await act(settle);

    await expect(
      checkPattern(screen.getByRole("checkbox"), "checkbox")
    ).resolves.toBeUndefined();
  });
});
