/** What a page tool says about itself to the agent that may call it. */
interface PageToolAnnotations {
  readonly consequentialHint?: boolean;
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

/** A value in what an agent passes a tool: JSON, as WebMCP delivers it. */
export type PageToolValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<PageToolValue>;

/** What an agent passes a tool, as named values. */
export type PageToolInput = Readonly<Record<string, PageToolValue>>;

/** What a tool hands the agent: text, or an object WebMCP serializes. */
type PageToolResult = string | object;

/** A tool the page offers an agent through WebMCP. */
export interface PageTool {
  readonly annotations: PageToolAnnotations;
  readonly description: string;
  readonly execute: (
    input: PageToolInput
  ) => PageToolResult | Promise<PageToolResult>;
  readonly inputSchema: object;
  readonly name: string;
}

interface ModelContext {
  readonly registerTool: (
    tool: PageTool,
    options: { readonly signal: AbortSignal }
  ) => Promise<void> | void;
  readonly unregisterTool?: (name: string) => void;
}

interface WithModelContext {
  readonly modelContext?: ModelContext;
}

const modelContextOf = (): ModelContext | undefined => {
  const onDocument = (document as Document & WithModelContext).modelContext;
  const onNavigator = (navigator as Navigator & WithModelContext).modelContext;

  return typeof onDocument?.registerTool === "function"
    ? onDocument
    : typeof onNavigator?.registerTool === "function"
      ? onNavigator
      : undefined;
};

/**
 * Offers `tools` to an agent through WebMCP, on `document.modelContext`, or on
 * `navigator.modelContext` where that is where the browser puts it. Without
 * WebMCP nothing registers. Returns the function that withdraws them.
 */
export const registerPageTools = (tools: ReadonlyArray<PageTool>) => {
  const context = modelContextOf();

  if (context === undefined) {
    return () => {};
  }

  const controller = new AbortController();
  const registered: Array<string> = [];

  for (const tool of tools) {
    try {
      const result = context.registerTool(tool, {
        signal: controller.signal,
      });

      registered.push(tool.name);

      // A later Chromium may return a promise that rejects with
      // NotAllowedError or AbortError, which are not worth surfacing.
      Promise.resolve(result).catch(() => {});
    } catch {
      // A name already registered throws InvalidStateError. The tool is on
      // the page, so there is nothing more to do.
    }
  }

  return () => {
    controller.abort();

    // Chromium 147 ignores the abort: the tool stayed listed 1.5 s after it,
    // and registering the name again threw InvalidStateError. unregisterTool
    // removes it, so React's second effect run in development can register.
    for (const name of registered) {
      try {
        context.unregisterTool?.(name);
      } catch {
        // The browser already withdrew it on the abort.
      }
    }
  };
};
