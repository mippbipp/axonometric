/** The message of a thrown value, for an error that names its cause. */
export const describeCause = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
