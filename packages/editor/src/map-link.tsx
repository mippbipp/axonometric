import { cn } from "@axonometric/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * A link from the map to a file or a page. `href` is a full URL, which is
 * kept as is, or a path relative to SYSTEM.md. `build` writes the page next
 * to SYSTEM.md, so the same relative path works from the page on disk.
 * Without an `href`, `children` shows as plain code-styled text.
 *
 * Links open in a new tab, so following one doesn't lose the walkthrough.
 */
export function MapLink({
  href,
  children,
  className,
}: {
  readonly href?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  if (href === undefined) {
    return <code className={cn("wrap-anywhere", className)}>{children}</code>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "focus-visible:outline-ink wrap-anywhere underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1",
        className
      )}
    >
      {children}
    </a>
  );
}
