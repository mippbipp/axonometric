import { announce } from "@axonometric/ui/lib/announce";
import { describe, expect, it } from "vitest";

const heard = (priority: "assertive" | "polite") =>
  document.querySelector(`[aria-live="${priority}"]`)?.textContent;

describe("announcing to screen readers", () => {
  it("writes the message to a polite live region", async () => {
    announce("3 structures selected.");

    await expect.poll(() => heard("polite")).toBe("3 structures selected.");
  });

  it("reads an urgent message from an assertive region", async () => {
    announce("Cancelled.", { priority: "assertive" });

    await expect.poll(() => heard("assertive")).toBe("Cancelled.");
  });
});
