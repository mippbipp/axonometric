import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@axonometric/ui/components/field";
import { Input } from "@axonometric/ui/components/input";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Name({
  disabled = false,
  onChange,
  refused,
}: {
  readonly disabled?: boolean;
  readonly onChange?: (value: string) => void;
  readonly refused?: string;
}) {
  const [name, setName] = useState("");

  return (
    <Field
      disabled={disabled}
      invalid={refused === undefined ? undefined : true}
    >
      <FieldLabel>Name</FieldLabel>
      <Input
        maxLength={5}
        onValueChange={(next) => {
          setName(next);
          onChange?.(next);
        }}
        value={name}
      />
      <FieldDescription>As on the map.</FieldDescription>
      {refused === undefined ? null : <FieldError match>{refused}</FieldError>}
    </Field>
  );
}

describe("input", () => {
  it("is named by its Field's label and described by its description", () => {
    expect.hasAssertions();

    render(<Name />);

    const box = screen.getByRole("textbox", { name: "Name" });

    expect(box.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText("As on the map.").id).toBe(
      box.getAttribute("aria-describedby")
    );
  });

  it("reports what is typed, up to its maxLength, and keeps the state it is given", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(<Name onChange={onChange} />);

    const box = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });

    await user.type(box, "Gateway");

    expect(onChange).toHaveBeenLastCalledWith("Gatew");
    expect(box.value).toBe("Gatew");
  });

  it("ties a refusal to the box, marks it invalid and says it", () => {
    expect.hasAssertions();

    render(<Name refused="That name is taken." />);

    const box = screen.getByRole("textbox", { name: "Name" });
    const error = screen.getByText("That name is taken.");

    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("has no error and no aria-invalid until something is refused", () => {
    expect.hasAssertions();

    render(<Name />);

    const box = screen.getByRole("textbox", { name: "Name" });

    expect(box.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("That name is taken.")).toBeNull();
  });

  it("ignores typing while disabled, and takes extra classes after its own", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(<Name disabled onChange={onChange} />);

    const box = screen.getByRole("textbox", { name: "Name" });

    await user.type(box, "a");

    expect(onChange).not.toHaveBeenCalled();
    expect(box.className).toContain("border-input");
  });
});
