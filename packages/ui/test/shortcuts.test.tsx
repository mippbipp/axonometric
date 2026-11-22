import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@axonometric/ui/components/dialog";
import { useShortcut } from "@axonometric/ui/lib/shortcuts";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

function Page({
  dialog,
  keys,
  onKey,
}: {
  readonly dialog: boolean;
  readonly keys: string;
  readonly onKey: () => void;
}) {
  useShortcut(keys, onKey);

  return (
    <Dialog open={dialog}>
      <DialogContent>
        <DialogTitle>Restore</DialogTitle>
        <button type="button">Close</button>
      </DialogContent>
    </Dialog>
  );
}

describe("page shortcuts", () => {
  it("pause while a modal dialog is open, and run again once it closes", async () => {
    expect.hasAssertions();
    const onKey = vi.fn<() => void>();
    const user = userEvent.setup();
    const { rerender } = render(<Page dialog keys="v" onKey={onKey} />);

    await act(settle);
    await user.keyboard("v");

    expect(onKey).not.toHaveBeenCalled();

    rerender(<Page dialog={false} keys="v" onKey={onKey} />);
    await act(settle);
    await user.keyboard("v");

    expect(onKey.mock.calls).toStrictEqual([[expect.any(KeyboardEvent)]]);
  });

  it("match Shift exactly, so a key with Shift is a shortcut of its own", async () => {
    expect.hasAssertions();
    const onKey = vi.fn<() => void>();
    const user = userEvent.setup();

    render(<Page dialog={false} keys="]" onKey={onKey} />);
    await user.keyboard("{Shift>}]{/Shift}");

    expect(onKey).not.toHaveBeenCalled();

    await user.keyboard("]");

    expect(onKey.mock.calls).toStrictEqual([[expect.any(KeyboardEvent)]]);
  });
});
