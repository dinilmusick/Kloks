import {spawn} from "node:child_process";

export interface LocalExecutionRequest {command: string; cwd?: string; environment?: Readonly<Record<string, string>>; timeoutMs?: number;}
export interface LocalExecutionResult {executionId: string; status: "succeeded" | "failed" | "timed-out"; exitCode?: number; stdout: string; stderr: string;}

// Only inherit the minimal OS environment needed to launch ordinary local
// commands. Application credentials (tokens, DB URLs, signing keys, etc.)
// must be passed explicitly by the caller for the specific execution.
const INHERITED_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "TERM",
] as const;

function buildExecutionEnvironment(
  explicit: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string") inherited[key] = value;
  }
  return { ...inherited, ...explicit };
}

export class LocalExecutionProvider {
  readonly id = "local";

  async execute(request: LocalExecutionRequest): Promise<LocalExecutionResult> {
    const executionId = crypto.randomUUID();
    return new Promise((resolve) => {
      const child = spawn("sh", ["-lc", request.command], {
        cwd: request.cwd,
        env: buildExecutionEnvironment(request.environment),
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: LocalExecutionResult) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(result); };
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => finish({executionId, status: "failed", exitCode: undefined, stdout, stderr: stderr + error.message}));
      child.on("close", (code) => finish({executionId, status: code === 0 ? "succeeded" : "failed", exitCode: code ?? undefined, stdout, stderr}));
      if (request.timeoutMs && request.timeoutMs > 0) timer = setTimeout(() => { child.kill("SIGTERM"); finish({executionId, status: "timed-out", stdout, stderr}); }, request.timeoutMs);
    });
  }
}
