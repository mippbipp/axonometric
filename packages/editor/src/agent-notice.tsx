/**
 * Says what the agent just did to the engineer's view, such as "Agent went
 * to chapter 4". Shows nothing without a notice.
 */
export function AgentNotice({ notice }: { readonly notice: string | null }) {
  if (notice === null) {
    return null;
  }

  return (
    <output
      className="border-ink bg-paper text-ink max-w-full shrink-0 border px-3 py-1.5 text-xs"
      data-agent-notice
    >
      {notice}
    </output>
  );
}
