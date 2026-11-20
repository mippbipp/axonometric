import {
  SegmentedControl,
  SegmentedControlItem,
} from "@axonometric/ui/components/segmented-control";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

type View = "iso" | "plan" | "top";

function Views({
  disabled = false,
  onChange,
}: {
  readonly disabled?: boolean;
  readonly onChange?: (value: View) => void;
}) {
  const [view, setView] = useState<View>("iso");

  return (
    <SegmentedControl<View>
      aria-label="View"
      className="w-full"
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) {
          setView(next);
          onChange?.(next);
        }
      }}
      value={view}
    >
      <SegmentedControlItem value="iso">Iso</SegmentedControlItem>
      <SegmentedControlItem value="plan">Plan</SegmentedControlItem>
      <SegmentedControlItem disabled value="top">
        Top
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

const checked = (name: string) =>
  screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("segmented control", () => {
  it("checks one option and follows a controlled value", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: View) => void>();
    const user = userEvent.setup();

    render(<Views onChange={onChange} />);

    expect(checked("Iso")).toBe("true");
    expect(checked("Plan")).toBe("false");

    await user.click(screen.getByRole("radio", { name: "Plan" }));

    expect(onChange).toHaveBeenCalledWith("plan");
    expect(checked("Iso")).toBe("false");
    expect(checked("Plan")).toBe("true");
  });

  it("is one Tab stop, and the arrow keys move and choose", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: View) => void>();
    const user = userEvent.setup();

    render(<Views onChange={onChange} />);
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Iso" })
    );
    expect(
      screen.getByRole("radio", { name: "Plan" }).getAttribute("tabindex")
    ).toBe("-1");

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Plan" })
    );
    expect(checked("Plan")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith("plan");
  });

  it("marks the chosen option with data-checked and styles it", () => {
    expect.hasAssertions();

    render(<Views />);

    const iso = screen.getByRole("radio", { name: "Iso" });

    expect(iso.dataset.checked).toBe("");
    expect(
      screen.getByRole("radio", { name: "Plan" }).dataset.checked
    ).toBeUndefined();
    expect(iso.className).toContain("data-[checked]:bg-muted");
  });

  it("doesn't choose a disabled option", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Views />);
    await user.click(screen.getByRole("radio", { name: "Top" }));

    expect(checked("Iso")).toBe("true");
    expect(checked("Top")).toBe("false");
  });

  it("chooses nothing while the whole row is disabled", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: View) => void>();
    const user = userEvent.setup();

    render(<Views disabled onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Plan" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(checked("Iso")).toBe("true");
  });

  it("takes extra classes after its own", () => {
    expect.hasAssertions();

    render(<Views />);

    const group = screen.getByRole("radiogroup");

    expect(group.className).toContain("w-full");
    expect(group.className).toContain("inline-flex");
  });

  it("follows the WAI-ARIA radio group pattern", async () => {
    expect.hasAssertions();

    render(<Views />);
    await act(settle);

    await expect(
      checkPattern(screen.getByRole("radiogroup"), "radio-group")
    ).resolves.toBeUndefined();
  });
});
