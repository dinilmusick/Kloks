import {afterEach, describe, expect, it, vi} from "vitest";
import {LocalExecutionProvider} from "./local-execution-provider.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LocalExecutionProvider", () => {
  it("executes a command and captures output", async () => {
    const result = await new LocalExecutionProvider().execute({command: "printf krusbl"});
    expect(result.status).toBe("succeeded");
    expect(result.stdout).toBe("krusbl");
  });

  it("reports non-zero exit codes", async () => {
    const result = await new LocalExecutionProvider().execute({command: "exit 7"});
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
  });

  it("does not inherit host credentials unless explicitly supplied", async () => {
    vi.stubEnv("GITHUB_TOKEN", "host-github-token-marker");
    vi.stubEnv("NPM_TOKEN", "host-npm-token-marker");
    vi.stubEnv("SYSTEM_DATABASE_URL", "postgresql://host-secret.example/db");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "host-google-secret-marker");

    const result = await new LocalExecutionProvider().execute({
      command: "node -e \"process.stdout.write(JSON.stringify({ github: process.env.GITHUB_TOKEN || null, npm: process.env.NPM_TOKEN || null, database: process.env.SYSTEM_DATABASE_URL || null, google: process.env.GOOGLE_CLIENT_SECRET || null, explicit: process.env.EXPLICIT_BUILD_FLAG || null }))\"",
      environment: { EXPLICIT_BUILD_FLAG: "caller-approved" },
      timeoutMs: 10_000,
    });

    expect(result.status).toBe("succeeded");
    const output = JSON.parse(result.stdout);
    expect(output).toEqual({
      github: null,
      npm: null,
      database: null,
      google: null,
      explicit: "caller-approved",
    });
    expect(result.stdout).not.toContain("host-github-token-marker");
    expect(result.stdout).not.toContain("host-npm-token-marker");
    expect(result.stdout).not.toContain("host-google-secret-marker");
  });
});
