import {describe, expect, it} from "vitest";
import {LocalExecutionProvider} from "./local-execution-provider.js";

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
});
