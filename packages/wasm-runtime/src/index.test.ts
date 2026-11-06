import { describe, expect, it } from "vitest";
import { supportedRuntimeEnvironments } from "../src/index.js";

describe("WASM runtime support matrix", () => {
  it("does not advertise non-Forge-compatible hosts", () => {
    expect(supportedRuntimeEnvironments()).toEqual({
      browser: true,
      node: false,
      vercel: false,
      "cloudflare-worker": false,
    });
  });
});
