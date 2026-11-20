import { Field, FieldLabel } from "@axonometric/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@axonometric/ui/components/select";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const rooms = [
  { label: "Deluxe king", value: "king" },
  { label: "Twin garden", value: "twin" },
  { disabled: true, label: "Family loft", value: "loft" },
];

function Rooms({
  onChange,
  placeholder,
}: {
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
}) {
  const [room, setRoom] = useState<string | null>(null);

  return (
    <Field name="room">
      <FieldLabel>Room type</FieldLabel>
      <Select
        items={rooms}
        onValueChange={(next) => {
          setRoom(next);

          if (next !== null) {
            onChange?.(next);
          }
        }}
        value={room}
      >
        <SelectTrigger placeholder={placeholder} />
        <SelectContent>
          {rooms.map((item) => (
            <SelectItem
              disabled={item.disabled}
              key={item.value}
              label={item.label}
              value={item.value}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

describe("select", () => {
  it("is a combobox named by its Field's label", () => {
    expect.hasAssertions();

    render(<Rooms />);

    expect(screen.getByRole("combobox", { name: "Room type" })).not.toBeNull();
  });

  it("shows the placeholder, then the chosen item, and reports the choice", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(<Rooms onChange={onChange} placeholder="Pick a room" />);

    const trigger = screen.getByRole("combobox", { name: "Room type" });

    expect(trigger.textContent).toContain("Pick a room");

    await user.click(trigger);
    await act(settle);
    await user.click(screen.getByRole("option", { name: "Twin garden" }));
    await act(settle);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("twin");
    expect(trigger.textContent).toContain("Twin garden");
  });

  it("opens from the keyboard and chooses with the arrow keys and Enter", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(<Rooms onChange={onChange} />);
    await user.tab();
    await user.keyboard("{Enter}");
    await act(settle);
    await user.keyboard("{ArrowDown}{Enter}");
    await act(settle);

    expect(onChange).toHaveBeenCalledWith(expect.any(String));
  });

  it("leaves a disabled item alone, and styles the chosen one with the data attribute ui-sdk sets", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(<Rooms onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await act(settle);
    await user.click(screen.getByRole("option", { name: "Family loft" }));

    expect(onChange).not.toHaveBeenCalled();

    const king = screen.getByRole("option", { name: "Deluxe king" });

    expect(king.className).toContain("data-[disabled]:opacity-40");

    await user.click(king);
    await act(settle);
    await user.click(screen.getByRole("combobox"));
    await act(settle);

    expect(
      screen.getByRole("option", { name: "Deluxe king" }).dataset.selected
    ).toBe("");
  });

  it("announces the list it opens, and names it by the label", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Rooms />);

    const trigger = screen.getByRole("combobox", { name: "Room type" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    await act(settle);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "Room type" })).not.toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("takes extra classes after its own", () => {
    expect.hasAssertions();

    render(
      <Select items={rooms} value="king">
        <SelectTrigger aria-label="Room" className="w-full" />
        <SelectContent />
      </Select>
    );

    const { className } = screen.getByRole("combobox", { name: "Room" });

    expect(className).toContain("w-full");
    expect(className).toContain("border-input");
  });
});
