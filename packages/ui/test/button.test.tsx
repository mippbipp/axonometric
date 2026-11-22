import { Button } from "@axonometric/ui/components/button";
import { buttonVariants } from "@axonometric/ui/lib/button-variants";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("button", () => {
  it("keeps the design system's variant and size classes", () => {
    expect.hasAssertions();

    render(
      <Button aria-label="Close" size="icon" variant="ghost">
        x
      </Button>
    );

    const button = screen.getByRole("button", { name: "Close" });

    expect(button.className).toContain("size-8");
    expect(button.className).toContain("hover:bg-muted");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("takes extra classes after the variant's", () => {
    expect.hasAssertions();

    render(<Button className="w-full">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" }).className).toContain(
      "w-full"
    );
  });

  it("runs onClick for a click, Enter and Space", async () => {
    expect.hasAssertions();

    const onClick = vi.fn<() => void>();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does nothing while disabled, and leaves the tab order", async () => {
    expect.hasAssertions();

    const onClick = vi.fn<() => void>();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(
      screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")
    ).toBeNull();
  });

  it("exposes the variant classes for a link styled as a button", () => {
    expect.hasAssertions();

    expect(buttonVariants({ variant: "link" })).toContain("underline-offset-4");
  });
});
