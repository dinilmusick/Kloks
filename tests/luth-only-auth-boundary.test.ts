import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const authServicePath = new URL("../packages/services/src/client-services/authService/index.ts", import.meta.url);
const storageServicePath = new URL("../packages/services/src/client-services/storageService/storageService.ts", import.meta.url);

describe("canonical Luth and SRKL authority boundaries", () => {
  it("delegates identity and sessions to the canonical Luth client", async () => {
    const source = await readFile(authServicePath, "utf8");
    expect(source).toContain("createLuthAuthClient");
    expect(source).toContain("signInWithEmail");
    expect(source).toContain("signUpWithEmail");
    expect(source).toContain("signOut");
    expect(source).not.toMatch(/localStorage|passwordHash|docustackAuthToken|admin123/);
  });

  it("loads storage accounts from SRKL without local credential persistence", async () => {
    const source = await readFile(storageServicePath, "utf8");
    expect(source).toContain("createSrklAccountClient");
    expect(source).toContain("includeCredentials: false");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("updateCurrentUserStorage");
    expect(source).not.toContain("STORAGE_KEY_CONNECTIONS");
  });
});
