import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("ecosystem promotion release metadata", () => {
  it("publishes the canonical KLOKS package identity", () => {
    expect(packageJson.name).toBe("@ultrst-armada/kloks");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.private).toBe(false);
  });
});
