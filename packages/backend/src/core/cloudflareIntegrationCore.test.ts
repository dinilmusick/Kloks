import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./srklCore", () => ({
  getSrklAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
  getPrimarySrklDeploymentUrl: vi.fn().mockResolvedValue("https://srkl.example"),
}));

import { fetchCloudflareData } from "./cloudflareIntegrationCore";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Cloudflare credential boundary", () => {
  it("does not forward a Cloudflare token to SRKL when the provider request fails", async () => {
    const secret = "cloudflare-token-must-not-leave-provider-boundary";
    const requests: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      throw new Error("Cloudflare unavailable");
    }) as typeof fetch;

    const result = await fetchCloudflareData({ token: secret, accountName: "Acme" });

    expect(result.success).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("api.cloudflare.com");
    expect(requests.join("\n")).not.toContain(secret);
    expect(requests.some((url) => url.includes("srkl.example"))).toBe(false);
  });
});
