import { Toggle } from "@axonometric/ui/components/toggle";
import { Toolbar, ToolbarButton } from "@axonometric/ui/components/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  WithTooltip,
  createTooltipController,
} from "@axonometric/ui/components/tooltip";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPattern, settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

/** How long ui-sdk treats tooltips as grouped after one closes, plus a margin. */
const warmWindow = 500;

type User = ReturnType<typeof userEvent.setup>;

function Hint({ delay = 0 }: { readonly delay?: number }) {
  return (
    <>
      <Tooltip delay={delay}>
        <TooltipTrigger aria-label="Undo">↶</TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>
      <p>Away</p>
    </>
  );
}

/** Moves the pointer to a place in the window. jsdom lays every box out at the origin, so the pointer leaves a trigger only by going somewhere else. */
const pointAt = (user: User, target: Element, at: number) =>
  user.pointer({ coords: { clientX: at, clientY: at }, target });

const away = (user: User) => pointAt(user, screen.getByText("Away"), 400);

/** `open` while ui-sdk shows the tooltip, `closed` while it only keeps it in the page. */
const stateOf = () =>
  screen.getByRole("tooltip", { hidden: true }).dataset.open === undefined
    ? "closed"
    : "open";

describe("tooltip", () => {
  it("opens when the pointer rests on the trigger and closes when it leaves", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Hint />);
    await act(settle);

    expect(stateOf()).toBe("closed");

    await pointAt(user, screen.getByRole("button", { name: "Undo" }), 5);
    await act(settle);

    expect(stateOf()).toBe("open");
    expect(screen.getByRole("tooltip").textContent).toBe("Undo (Ctrl+Z)");

    await away(user);
    await act(settle);

    expect(stateOf()).toBe("closed");
  });

  it("opens on keyboard focus, and Escape closes it and leaves focus on the trigger", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Hint />);
    await user.tab();
    await act(settle);

    const trigger = screen.getByRole("button", { name: "Undo" });

    expect(document.activeElement).toBe(trigger);
    expect(stateOf()).toBe("open");

    await user.keyboard("{Escape}");
    await act(settle);

    expect(stateOf()).toBe("closed");
    expect(document.activeElement).toBe(trigger);
  });

  it("describes a trigger that has a name of its own, and keeps the tooltip out of the Tab order", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(<Hint />);
    await act(settle);

    const trigger = screen.getByRole("button", { name: "Undo" });
    const tip = screen.getByRole("tooltip", { hidden: true });

    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.getAttribute("tabindex")).toBeNull();

    await user.tab();
    await user.tab();

    expect(document.activeElement).toBe(document.body);
  });

  it("waits for its delay before opening, and not at all if the pointer leaves first", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    // ui-sdk opens a tooltip at once while another was open a moment ago.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, warmWindow);
      });
    });
    render(<Hint delay={5000} />);
    await act(settle);

    await pointAt(user, screen.getByRole("button", { name: "Undo" }), 5);
    await act(settle);

    expect(stateOf()).toBe("closed");

    await away(user);
    await act(settle);

    expect(stateOf()).toBe("closed");
  });

  it("keeps the design system's popup classes, and fades with the data attributes ui-sdk sets", async () => {
    expect.hasAssertions();

    render(<Hint />);
    await act(settle);

    const { className } = screen.getByRole("tooltip", { hidden: true });

    expect(className).toContain("bg-popover");
    expect(className).toContain("data-[starting-style]:opacity-0");
    expect(className).toContain("data-[instant]:transition-none");
    expect(className).not.toMatch(
      /(?<![\w[])data-(?:starting-style|ending-style|instant|open|closed):/u
    );
  });

  it("takes extra classes after the popup's", async () => {
    expect.hasAssertions();

    render(
      <Tooltip>
        <TooltipTrigger aria-label="Undo">↶</TooltipTrigger>
        <TooltipContent className="pointer-events-none">Undo</TooltipContent>
      </Tooltip>
    );
    await act(settle);

    expect(screen.getByRole("tooltip", { hidden: true }).className).toContain(
      "pointer-events-none"
    );
  });

  it("shows one shared tooltip for many triggers, each with its payload, even on an SVG element", async () => {
    expect.hasAssertions();

    const controller = createTooltipController<string>();
    const user = userEvent.setup();

    render(
      <>
        <svg aria-label="map">
          {["Alpha", "Beta"].map((name) => (
            <TooltipTrigger
              controller={controller}
              key={name}
              payload={name}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <button> element, as on the map's structures.
              render={<g aria-label={name} role="button" tabIndex={0} />}
            >
              <rect height="10" width="10" />
            </TooltipTrigger>
          ))}
        </svg>
        <Tooltip controller={controller} delay={0}>
          <TooltipContent<string>>{(state) => state.payload}</TooltipContent>
        </Tooltip>
        <p>Away</p>
      </>
    );
    await act(settle);

    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });

    await pointAt(user, alpha, 5);
    await act(settle);

    expect(screen.getByRole("tooltip").textContent).toBe("Alpha");
    expect(alpha.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id
    );

    await pointAt(user, beta, 25);
    await act(settle);

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip").textContent).toBe("Beta");

    await away(user);
    await act(settle);

    expect(stateOf()).toBe("closed");
  });

  it("describes a control it wraps, with the control's own name and props kept", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(
      <>
        <WithTooltip
          control={<Toggle data-control="note">Note</Toggle>}
          delay={0}
        >
          Pin a note to an empty spot
        </WithTooltip>
        <p>Away</p>
      </>
    );
    await act(settle);

    const note = screen.getByRole("button", { name: "Note" });

    expect(note.dataset.control).toBe("note");
    expect(note.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip", { hidden: true }).id
    );

    await user.tab();
    await act(settle);

    expect(stateOf()).toBe("open");
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Pin a note to an empty spot"
    );

    await user.click(note);

    expect(note.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a tooltip on a disabled toolbar button, which stays reachable by arrow keys", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(
      <Toolbar aria-label="Edit">
        <ToolbarButton>Group</ToolbarButton>
        <WithTooltip control={<ToolbarButton disabled>Undo</ToolbarButton>}>
          Nothing to undo
        </WithTooltip>
      </Toolbar>
    );
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await act(settle);

    const undo = screen.getByRole("button", { name: "Undo" });

    expect(document.activeElement).toBe(undo);
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(stateOf()).toBe("open");
    expect(screen.getByRole("tooltip").textContent).toBe("Nothing to undo");
  });

  it("keeps a disabled toolbar button inert to a click while its tooltip shows on hover", async () => {
    expect.hasAssertions();

    const onClick = vi.fn<() => void>();
    const user = userEvent.setup();

    render(
      <>
        <Toolbar aria-label="Edit">
          <WithTooltip
            control={
              <ToolbarButton
                className="aria-disabled:pointer-events-auto"
                disabled
                onClick={onClick}
              >
                Undo
              </ToolbarButton>
            }
            delay={0}
          >
            Nothing to undo
          </WithTooltip>
        </Toolbar>
        <p>Away</p>
      </>
    );
    await act(settle);

    const undo = screen.getByRole("button", { name: "Undo" });

    await pointAt(user, undo, 5);
    await act(settle);

    expect(stateOf()).toBe("open");

    await user.click(undo);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays off when disabled, and the control still works", async () => {
    expect.hasAssertions();

    const user = userEvent.setup();

    render(
      <WithTooltip control={<Toggle>Edit</Toggle>} disabled>
        Edit the map
      </WithTooltip>
    );
    await user.tab();
    await act(settle);

    expect(stateOf()).toBe("closed");

    await user.keyboard(" ");

    expect(
      screen.getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("keeps a toolbar of wrapped controls a WAI-ARIA toolbar", async () => {
    expect.hasAssertions();

    render(
      <Toolbar aria-label="Edit">
        <WithTooltip control={<ToolbarButton>Undo</ToolbarButton>}>
          Undo
        </WithTooltip>
        <WithTooltip control={<Toggle>Note</Toggle>}>Note</WithTooltip>
      </Toolbar>
    );
    await act(settle);

    await expect(
      checkPattern(screen.getByRole("toolbar"), "toolbar")
    ).resolves.toBeUndefined();
  });
});
