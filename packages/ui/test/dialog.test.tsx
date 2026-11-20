import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  createDialogController,
} from "@axonometric/ui/components/dialog";
import type { DialogController } from "@axonometric/ui/components/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@axonometric/ui/components/menu";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

function Share({
  onOpenChange,
}: {
  readonly onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        onOpenChange?.(open);
      }}
    >
      <DialogTrigger>Share</DialogTrigger>
      <DialogBackdrop data-testid="backdrop" />
      <DialogContent>
        <DialogTitle>Share link</DialogTitle>
        <DialogDescription>Anyone with the link can view it.</DialogDescription>
        <button type="button">Copy</button>
        <DialogClose>Done</DialogClose>
      </DialogContent>
    </Dialog>
  );
}

async function openShare(onOpenChange?: (open: boolean) => void) {
  const user = userEvent.setup();

  render(<Share onOpenChange={onOpenChange} />);

  const trigger = screen.getByRole("button", { name: "Share" });

  await user.click(trigger);
  await act(settle);

  return { trigger, user };
}

describe("dialog", () => {
  it("is named by its title and described by its description", async () => {
    expect.hasAssertions();

    await openShare();

    const dialog = screen.getByRole("dialog", { name: "Share link" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(
      screen.queryByText("Anyone with the link can view it.")
    ).not.toBeNull();
  });

  it("moves focus in on open, and returns it to the trigger on Escape", async () => {
    expect.hasAssertions();

    const { trigger, user } = await openShare();
    const dialog = screen.getByRole("dialog", { name: "Share link" });

    expect(document.activeElement?.closest("[role=dialog]")).toBe(dialog);

    await user.keyboard("{Escape}");
    await act(settle);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from a Close part and reports why", async () => {
    expect.hasAssertions();

    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { trigger, user } = await openShare(onOpenChange);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await act(settle);

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab inside while open", async () => {
    expect.hasAssertions();

    const { user } = await openShare();
    const dialog = screen.getByRole("dialog", { name: "Share link" });

    for (let press = 0; press < 5; press += 1) {
      await user.tab();

      expect(document.activeElement?.closest("[role=dialog]")).toBe(dialog);
    }
  });

  it("keeps its backdrop, content and title classes, and takes extra ones after", async () => {
    expect.hasAssertions();

    render(
      <Dialog defaultOpen>
        <DialogBackdrop data-testid="backdrop" />
        <DialogContent className="max-h-none">
          <DialogTitle className="mb-2">Share link</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    await act(settle);

    expect(screen.getByTestId("backdrop").className).toContain("bg-black/40");

    const { className } = screen.getByRole("dialog", { name: "Share link" });

    expect(className).toContain("bg-popover");
    expect(className).toContain("max-h-none");
    expect(className).not.toContain("max-h-[80svh]");
    expect(screen.getByRole("heading", { name: "Share link" }).className).toBe(
      "text-sm font-medium mb-2"
    );
  });

  it("passes the WAI-ARIA dialog pattern", async () => {
    expect.hasAssertions();

    await openShare();

    await expect(
      checkPattern(screen.getByRole("dialog"), "dialog")
    ).resolves.toBeUndefined();
  });
});

function Files({ controller }: { readonly controller: DialogController }) {
  return (
    <>
      <Menu>
        <MenuTrigger>File</MenuTrigger>
        <MenuContent>
          <MenuItem
            onSelect={() => {
              void controller.open();
            }}
          >
            Rename
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog controller={controller}>
        <DialogBackdrop />
        <DialogContent>
          <DialogTitle>Rename file</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("dialog opened from a menu item", () => {
  it("moves focus in, and returns it to the menu's trigger on close", async () => {
    expect.hasAssertions();

    const controller = createDialogController();
    const user = userEvent.setup();

    render(<Files controller={controller} />);

    const trigger = screen.getByRole("button", { name: "File" });

    await user.click(trigger);
    await act(settle);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await act(settle);

    const dialog = screen.getByRole("dialog", { name: "Rename file" });

    expect(document.activeElement?.closest("[role=dialog]")).toBe(dialog);

    await user.keyboard("{Escape}");
    await act(settle);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("resolves the controller's promise with how it closed", async () => {
    expect.hasAssertions();

    const controller = createDialogController();
    const user = userEvent.setup();

    render(<Files controller={controller} />);

    const closed = controller.open();

    await act(settle);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(closed).resolves.toMatchObject({ reason: "close-press" });
  });
});
