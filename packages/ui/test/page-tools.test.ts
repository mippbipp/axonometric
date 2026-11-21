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
    ) => Promise<void>;
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

    const registerTool = vi.fn<
      (tool: PageTool, o: { signal: AbortSignal }) => Promise<void>
    >(async () => {});

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

    const registerTool = vi.fn<
      (tool: PageTool, o: { signal: AbortSignal }) => Promise<void>
    >(async () => {});

    install(navigator, { registerTool });
    registerPageTools([tool("a")]);

    expect(registerTool.mock.calls.map(([one]) => one.name)).toStrictEqual([
      "a",
    ]);
  });

  it("aborts the signal and unregisters each tool when withdrawn", () => {
    expect.hasAssertions();
    reset();

    const registerTool = vi.fn<
      (tool: PageTool, o: { signal: AbortSignal }) => Promise<void>
    >(async () => {});
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

  it.each(["AbortError", "InvalidStateError"])(
    "lets a registration rejected with %s go",
    async (name) => {
      expect.hasAssertions();
      reset();

      const rejected = Promise.reject(new DOMException("refused", name));
      const report = vi.spyOn(globalThis, "reportError");

      install(document, { registerTool: () => rejected });
      registerPageTools([tool("a")]);
      await rejected.catch(() => {});

      expect(report).not.toHaveBeenCalled();

      report.mockRestore();
    }
  );

  it("reports a registration rejected for any other reason", async () => {
    expect.hasAssertions();
    reset();

    const error = new TypeError("bad schema");
    const rejected = Promise.reject(error);
    const report = vi
      .spyOn(globalThis, "reportError")
      .mockImplementation(() => {});

    install(document, { registerTool: () => rejected });
    registerPageTools([tool("a")]);
    await rejected.catch(() => {});

    expect(report).toHaveBeenCalledExactlyOnceWith(error);

    report.mockRestore();
  });
});
