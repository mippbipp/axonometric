import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@axonometric/ui/components/tabs";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

type Name = "account" | "billing" | "team";

function Settings({
  defaultValue,
  onChange,
}: {
  readonly defaultValue?: Name;
  readonly onChange?: (value: Name | null) => void;
}) {
  return (
    <Tabs<Name> defaultValue={defaultValue} onValueChange={onChange}>
      <TabsList aria-label="Settings">
        <TabsTab value="account">Account</TabsTab>
        <TabsTab disabled value="billing">
          Billing
        </TabsTab>
        <TabsTab value="team">Team</TabsTab>
      </TabsList>
      <TabsPanel value="account">Your profile</TabsPanel>
      <TabsPanel value="billing">Your invoices</TabsPanel>
      <TabsPanel value="team">Your people</TabsPanel>
    </Tabs>
  );
}

function Controlled({ onChange }: { readonly onChange: (v: Name) => void }) {
  const [value, setValue] = useState<Name>("team");

  return (
    <Tabs<Name>
      onValueChange={(next) => {
        if (next !== null) {
          setValue(next);
          onChange(next);
        }
      }}
      value={value}
    >
      <TabsList aria-label="Settings">
        <TabsTab value="account">Account</TabsTab>
        <TabsTab value="team">Team</TabsTab>
      </TabsList>
      <TabsPanel value="account">Your profile</TabsPanel>
      <TabsPanel value="team">Your people</TabsPanel>
    </Tabs>
  );
}

describe("tabs", () => {
  it("shows the first enabled tab's panel, and only that panel", () => {
    expect.hasAssertions();

    render(<Settings />);

    expect(
      screen.getByRole("tab", { name: "Account" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Your profile");
    expect(screen.queryByText("Your people")).toBeNull();
  });

  it("names the panel after its tab", () => {
    expect.hasAssertions();

    render(<Settings defaultValue="team" />);

    expect(screen.getByRole("tabpanel", { name: "Team" }).textContent).toBe(
      "Your people"
    );
  });

  it("keeps one Tab stop on the list, at the selected tab", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Settings defaultValue="team" />);

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Team" })
    );
    expect(
      screen.getByRole("tab", { name: "Account" }).getAttribute("tabindex")
    ).toBe("-1");
  });

  it("moves and selects with the arrow keys, wrapping at the ends, and focuses a disabled tab without selecting it", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: Name | null) => void>();
    const user = userEvent.setup();

    render(<Settings onChange={onChange} />);

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Billing" })
    );
    expect(screen.getByRole("tabpanel").textContent).toBe("Your profile");

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Team" })
    );

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Account" })
    );
    expect(onChange).toHaveBeenLastCalledWith("account", expect.anything());
  });

  it("marks a disabled tab and doesn't select it on click", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Settings />);

    const billing = screen.getByRole("tab", { name: "Billing" });

    await user.click(billing);

    expect(billing.getAttribute("aria-disabled")).toBe("true");
    expect(billing.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").textContent).toBe("Your profile");
  });

  it("styles a disabled tab with the data attribute ui-sdk sets", () => {
    expect.hasAssertions();

    render(<Settings />);

    const billing = screen.getByRole("tab", { name: "Billing" });

    expect(billing.dataset.disabled).toBe("");
    expect(billing.className).toContain("data-[disabled]:opacity-50");
    expect(billing.className).not.toMatch(/(?<![\w[])data-disabled:/u);
    expect(
      screen.getByRole("tab", { name: "Account" }).dataset.disabled
    ).toBeUndefined();
  });

  it("follows a controlled value and reports each choice", async () => {
    expect.hasAssertions();

    const onChange = vi.fn<(value: Name) => void>();
    const user = userEvent.setup();

    render(<Controlled onChange={onChange} />);

    expect(screen.getByRole("tabpanel").textContent).toBe("Your people");

    await user.click(screen.getByRole("tab", { name: "Account" }));

    expect(onChange).toHaveBeenCalledWith("account");
    expect(screen.getByRole("tabpanel").textContent).toBe("Your profile");
  });

  it("styles the selected tab and keeps the design system's classes", () => {
    expect.hasAssertions();

    render(<Settings />);

    expect(screen.getByRole("tab", { name: "Account" }).className).toContain(
      "data-[selected]:bg-background"
    );
    expect(screen.getByRole("tablist").className).toContain("bg-muted");
  });

  it("takes extra classes after its own", () => {
    expect.hasAssertions();

    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="x" className="w-full">
          <TabsTab value="a">A</TabsTab>
        </TabsList>
      </Tabs>
    );

    const list = screen.getByRole("tablist");

    expect(list.className).toContain("w-full");
    expect(list.className).toContain("bg-muted");
  });

  it("follows the WAI-ARIA tabs pattern", async () => {
    expect.hasAssertions();

    render(<Settings />);
    await act(settle);

    await expect(
      checkPattern(screen.getByRole("tablist"), "tabs")
    ).resolves.toBeUndefined();
  });
});
