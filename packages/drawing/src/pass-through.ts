import type { ReactNode } from "react";

/** A file has no editor around its structures. */
export const PassThrough = ({ children }: { readonly children: ReactNode }) =>
  children;
