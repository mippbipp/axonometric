import { registerPageTools } from "@axonometric/ui/lib/page-tools";
import type { PageTool } from "@axonometric/ui/lib/page-tools";
import { describe, expect, it, vi } from "vitest";

const tool = (name: string): PageTool => ({
  annotations: { readOnlyHint: true },
  description: `The ${name} tool.`,
  execute: () => name,
  inputSchema: { properties: {}, type: "object" },
  name,
});

const install = (
  where: Document | Navigator,
  context: {
    registerTool: (
      tool: PageTool,
      options: { signal: AbortSignal }
    ) => Promise<void> | void;
    unregisterTool?: (name: string) => void;
  }
) => {
  Object.defineProperty(where, "modelContext", {
    configurable: true,
    value: context,
  });
};

const reset = () => {
  Reflect.deleteProperty(document, "modelContext");
  Reflect.deleteProperty(navigator, "modelContext");
};

describe("registering page tools", () => {
  it("registers nothing, and doesn't throw, without WebMCP", () => {
    expect.hasAssertions();
    reset();

    const withdraw = registerPageTools([tool("read_view")]);

    expect(() => {
      withdraw();
    }).not.toThrow();
  });

  it("registers each tool once, with a signal", () => {
    expect.hasAssertions();
    reset();

    const registerTool =
      vi.fn<(tool: PageTool, o: { signal: AbortSignal }) => void>();

    install(document, { registerTool });
    registerPageTools([tool("a"), tool("b")]);

    expect(registerTool.mock.calls.map(([one]) => one.name)).toStrictEqual([
      "a",
      "b",
    ]);
    expect(registerTool.mock.calls[0]?.[1].signal).toHaveProperty(
      "aborted",
      false
    );
  });

  it("falls back to navigator.modelContext", () => {
    expect.hasAssertions();
    reset();

    const registerTool =
      vi.fn<(tool: PageTool, o: { signal: AbortSignal }) => void>();

    install(navigator, { registerTool });
    registerPageTools([tool("a")]);

    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("aborts the signal and unregisters each tool when withdrawn", () => {
    expect.hasAssertions();
    reset();

    const registerTool =
      vi.fn<(tool: PageTool, o: { signal: AbortSignal }) => void>();
    const unregisterTool = vi.fn<(name: string) => void>();

    install(document, { registerTool, unregisterTool });

    const withdraw = registerPageTools([tool("a"), tool("b")]);

    withdraw();

    expect(registerTool.mock.calls[0]?.[1].signal).toHaveProperty(
      "aborted",
      true
    );
    expect(unregisterTool.mock.calls.map(([name]) => name)).toStrictEqual([
      "a",
      "b",
    ]);
  });

  it("swallows a rejected NotAllowedError", async () => {
    expect.hasAssertions();
    reset();

    const rejected = Promise.reject(
      new DOMException("not allowed", "NotAllowedError")
    );

    install(document, { registerTool: () => rejected });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerPageTools([tool("a")]);
    await rejected.catch(() => {});

    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it("swallows a synchronous InvalidStateError", () => {
    expect.hasAssertions();
    reset();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    install(document, {
      registerTool: () => {
        throw new DOMException("duplicate", "InvalidStateError");
      },
    });

    expect(() => registerPageTools([tool("a")])).not.toThrow();

    warn.mockRestore();
  });

  it("works when registerTool returns nothing, as Chromium 147 does", () => {
    expect.hasAssertions();
    reset();

    install(document, { registerTool: () => {} });

    expect(() => {
      registerPageTools([tool("a")])();
    }).not.toThrow();
  });
});
