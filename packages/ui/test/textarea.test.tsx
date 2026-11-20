import {
  Field,
  FieldError,
  FieldLabel,
} from "@axonometric/ui/components/field";
import { Textarea } from "@axonometric/ui/components/textarea";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Note({
  disabled = false,
  onSend,
  refused,
}: {
  readonly disabled?: boolean;
  readonly onSend?: (text: string) => void;
  readonly refused?: string;
}) {
  const [text, setText] = useState("");

  return (
    <Field
      disabled={disabled}
      invalid={refused === undefined ? undefined : true}
    >
      <FieldLabel>Note</FieldLabel>
      <Textarea
        onSubmit={(value) => {
          onSend?.(value);
        }}
        onValueChange={setText}
        submitShortcut="mod+enter"
        value={text}
      />
      {refused === undefined ? null : <FieldError match>{refused}</FieldError>}
    </Field>
  );
}

describe("textarea", () => {
  it("is named by its Field's label", () => {
    expect.hasAssertions();

    render(<Note />);

    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe(
      "TEXTAREA"
    );
  });

  it("starts a new line on Enter and sends on Ctrl+Enter", async () => {
    expect.hasAssertions();

    const onSend = vi.fn<(text: string) => void>();
    const user = userEvent.setup();

    render(<Note onSend={onSend} />);

    const box = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Note",
    });

    await user.type(box, "one{Enter}two");

    expect(box.value).toBe("one\ntwo");
    expect(onSend).not.toHaveBeenCalled();

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSend).toHaveBeenCalledWith("one\ntwo");
  });

  it("ties a refusal to the box", () => {
    expect.hasAssertions();

    render(<Note refused="Too long." />);

    const box = screen.getByRole("textbox", { name: "Note" });

    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toContain(
      screen.getByText("Too long.").id
    );
  });

  it("ignores typing while disabled, and takes extra classes after its own", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Note disabled />);

    const box = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Note",
    });

    await user.type(box, "a");

    expect(box.value).toBe("");
    expect(box.className).toContain("border-input");
  });
});
