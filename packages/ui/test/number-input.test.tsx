import { Field, FieldLabel } from "@axonometric/ui/components/field";
import {
  NumberInput,
  NumberInputControl,
} from "@axonometric/ui/components/number-input";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Coordinate({
  disabled = false,
  onChange,
}: {
  readonly disabled?: boolean;
  readonly onChange?: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(null);

  return (
    <Field disabled={disabled}>
      <FieldLabel>x</FieldLabel>
      <NumberInput
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        step={0.5}
        value={value}
      >
        <NumberInputControl />
      </NumberInput>
    </Field>
  );
}

describe("number input", () => {
  it("is named by its Field's label and starts empty", () => {
    expect.hasAssertions();

    render(<Coordinate />);

    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "x" }).value
    ).toBe("");
  });

  it("reports a typed number, and null when it is emptied", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: number | null) => void>();
    const user = userEvent.setup();

    render(<Coordinate onChange={onChange} />);

    const box = screen.getByRole("textbox", { name: "x" });

    await user.type(box, "12.5");

    expect(onChange).toHaveBeenLastCalledWith(12.5);

    await user.clear(box);

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("steps by its step with the arrow keys", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: number | null) => void>();
    const user = userEvent.setup();

    render(<Coordinate onChange={onChange} />);
    await user.click(screen.getByRole("textbox", { name: "x" }));
    await user.keyboard("{ArrowUp}{ArrowUp}");

    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ignores typing while disabled, and takes extra classes after its own", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: number | null) => void>();
    const user = userEvent.setup();

    render(<Coordinate disabled onChange={onChange} />);

    const box = screen.getByRole("textbox", { name: "x" });

    await user.type(box, "3");

    expect(onChange).not.toHaveBeenCalled();
    expect(box.className).toContain("border-input");
  });
});
