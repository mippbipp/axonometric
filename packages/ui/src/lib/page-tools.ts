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
  ) => Promise<void>;
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
 * How Chromium 156 refuses a registration: AbortError once the tools are
 * withdrawn, and InvalidStateError for a name already registered, which
 * leaves that tool on the page.
 */
const expected = new Set(["AbortError", "InvalidStateError"]);

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
    registered.push(tool.name);
    context
      .registerTool(tool, { signal: controller.signal })
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- effecttsgo/async-function bans the async form it asks for.
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && expected.has(error.name))) {
          reportError(error);
        }
      });
  }

  return () => {
    controller.abort();

    // Chromium 147 kept a tool listed after the abort, so registering the
    // name again threw InvalidStateError until unregisterTool removed it.
    // Chromium 156 withdraws on the abort and has no unregisterTool.
    for (const name of registered) {
      try {
        context.unregisterTool?.(name);
      } catch {
        // The browser already withdrew it on the abort.
      }
    }
  };
};
