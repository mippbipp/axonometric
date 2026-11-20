import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  createMenuController,
} from "@axonometric/ui/components/menu";
import type { MenuController } from "@axonometric/ui/components/menu";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

function FileMenu({ onRename }: { readonly onRename?: () => void }) {
  return (
    <Menu>
      <MenuTrigger>File</MenuTrigger>
      <MenuContent>
        <MenuLabel>Document</MenuLabel>
        <MenuItem onSelect={onRename}>Rename</MenuItem>
        <MenuSeparator />
        <MenuCheckboxItem value="wrap">Word wrap</MenuCheckboxItem>
        <MenuRadioGroup defaultValue="name">
          <MenuRadioItem value="name">By name</MenuRadioItem>
          <MenuRadioItem value="date">By date</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSub>
          <MenuSubTrigger>Share</MenuSubTrigger>
          <MenuSubContent>
            <MenuItem>Copy link</MenuItem>
          </MenuSubContent>
        </MenuSub>
      </MenuContent>
    </Menu>
  );
}

async function openFileMenu(onRename?: () => void) {
  const user = userEvent.setup();

  render(<FileMenu onRename={onRename} />);

  const trigger = screen.getByRole("button", { name: "File" });

  await user.click(trigger);
  await act(settle);

  return { trigger, user };
}

describe("menu", () => {
  it("runs an item's onSelect on Enter, then closes and returns focus to the trigger", async () => {
    expect.hasAssertions();

    const onRename = vi.fn<() => void>();
    const { trigger, user } = await openFileMenu(onRename);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onRename).toHaveBeenCalledWith(expect.any(Event));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps its popup, item and checked classes", async () => {
    expect.hasAssertions();

    await openFileMenu();

    expect(screen.getByRole("menu").className).toContain("bg-popover");
    expect(
      screen.getByRole("menuitem", { name: "Rename" }).className
    ).toContain("data-highlighted:bg-accent");
  });

  it("styles a disabled item with the data attribute ui-sdk sets", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(
      <Menu>
        <MenuTrigger>File</MenuTrigger>
        <MenuContent>
          <MenuItem>Rename</MenuItem>
          <MenuItem disabled>Delete</MenuItem>
        </MenuContent>
      </Menu>
    );
    await user.click(screen.getByRole("button", { name: "File" }));
    await act(settle);

    const remove = screen.getByRole("menuitem", { name: "Delete" });

    expect(remove.dataset.disabled).toBe("");
    expect(remove.className).toContain("data-[disabled]:opacity-50");
    expect(remove.className).not.toMatch(/(?<![\w[])data-disabled:/u);
    expect(
      screen.getByRole("menuitem", { name: "Rename" }).dataset.disabled
    ).toBeUndefined();
  });

  it("toggles a checkbox item and keeps the menu open", async () => {
    expect.hasAssertions();

    const { user } = await openFileMenu();
    const wrap = screen.getByRole("menuitemcheckbox", { name: "Word wrap" });

    expect(wrap.getAttribute("aria-checked")).toBe("false");

    await user.click(wrap);

    expect(wrap.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  it("selects one radio item at a time", async () => {
    expect.hasAssertions();

    const { user } = await openFileMenu();
    const byDate = screen.getByRole("menuitemradio", { name: "By date" });

    await user.click(byDate);

    expect(byDate.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", { name: "By name" })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  it("opens a submenu with ArrowRight, and Escape closes only the submenu", async () => {
    expect.hasAssertions();

    const { user } = await openFileMenu();

    await user.keyboard("{End}");

    const share = screen.getByRole("menuitem", { name: "Share" });

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Copy link" })
    );

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(share);
    expect(share.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("follows the WAI-ARIA menu pattern", async () => {
    expect.hasAssertions();

    await openFileMenu();

    await expect(
      checkPattern(screen.getByRole("menu"), "menu")
    ).resolves.toBeUndefined();
  });
});

function ContextMenu({
  controller,
  onRename,
}: {
  readonly controller: MenuController;
  readonly onRename: () => void;
}) {
  return (
    <>
      <button type="button">Target</button>
      <Menu controller={controller}>
        <MenuContent aria-label="Server">
          <MenuItem onSelect={onRename}>Rename</MenuItem>
          <MenuItem>Delete</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}

describe("menu opened from a controller at a point", () => {
  it("opens at the point, runs an item and returns focus to the element focused before", async () => {
    expect.hasAssertions();

    const controller = createMenuController();
    const onRename = vi.fn<() => void>();
    const user = userEvent.setup();

    render(<ContextMenu controller={controller} onRename={onRename} />);

    const target = screen.getByRole("button", { name: "Target" });

    target.focus();
    await act(async () => {
      void controller.open({ anchor: { x: 40, y: 60 } });
      await settle();
    });

    expect(screen.queryByRole("menu", { name: "Server" })).not.toBeNull();

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Rename" })
    );

    await user.keyboard("{Enter}");

    expect(onRename).toHaveBeenCalledWith(expect.any(Event));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it("puts focus on the menu itself when asked to, as a right-click needs", async () => {
    expect.hasAssertions();

    const controller = createMenuController();

    const user = userEvent.setup();

    render(<ContextMenu controller={controller} onRename={() => {}} />);
    await act(async () => {
      void controller.open({ anchor: { x: 0, y: 0 }, focus: "popup" });
      await settle();
    });

    expect(document.activeElement).toBe(screen.getByRole("menu"));

    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Rename" })
    );
  });

  it("returns focus to the element focused before when Escape closes it", async () => {
    expect.hasAssertions();

    const controller = createMenuController();
    const user = userEvent.setup();

    render(<ContextMenu controller={controller} onRename={() => {}} />);

    const target = screen.getByRole("button", { name: "Target" });

    target.focus();
    await act(async () => {
      void controller.open({ anchor: { x: 0, y: 0 } });
      await settle();
    });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it("follows the WAI-ARIA menu pattern", async () => {
    expect.hasAssertions();

    const controller = createMenuController();

    render(<ContextMenu controller={controller} onRename={() => {}} />);
    screen.getByRole("button", { name: "Target" }).focus();
    await act(async () => {
      void controller.open({ anchor: { x: 0, y: 0 } });
      await settle();
    });

    await expect(
      checkPattern(screen.getByRole("menu"), "menu")
    ).resolves.toBeUndefined();
  });
});
