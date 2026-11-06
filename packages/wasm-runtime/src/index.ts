import {
  createBrowserEngine,
  type Engine,
} from "@wasm-oj/browser";
import { browserSource as goSource } from "@wasm-oj/toolchain-go";
import { browserSource as rustSource } from "@wasm-oj/toolchain-rust";

export type SupportedLanguage = "rust" | "go";

export type RuntimeEnvironment =
  | "browser"
  | "node"
  | "vercel"
  | "cloudflare-worker";

export interface RuntimeInputs {
  [key: string]: unknown;
}

export interface RuntimeOptions {
  target?: "wasip1" | "wasix";
  optimization?: "debug" | "release";
  timeoutMs?: number;
  toolchainBaseUrl?: string;
}

export interface RuntimeDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  source?: string;
  code?: string;
}

export interface RuntimeExecuteRequest {
  language: SupportedLanguage;
  source: string;
  inputs?: RuntimeInputs;
  options?: RuntimeOptions;
}

export interface RuntimeResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  value?: unknown;
  diagnostics?: RuntimeDiagnostic[];
  executionTimeMs?: number;
}

export interface WasmRuntime {
  execute(request: RuntimeExecuteRequest): Promise<RuntimeResult>;
  dispose(): void;
}

export interface BrowserWasmRuntimeOptions {
  toolchainBaseUrl?: string;
  artifactCache?: boolean;
}

const DEFAULT_TOOLCHAIN_BASE_URL = "/toolchains/";

function inputToStdin(inputs: RuntimeInputs | undefined): string {
  if (inputs === undefined) return "";
  return `${JSON.stringify(inputs)}\n`;
}

function sourceProject(
  language: SupportedLanguage,
  source: string,
  options: RuntimeOptions,
) {
  const extension = language === "rust" ? "rs" : "go";
  const entry = `main.${extension}`;

  return {
    language,
    target: options.target ?? "wasip1",
    optimization: options.optimization ?? "release",
    entry,
    files: { [entry]: source },
  } as const;
}

function diagnostics(
  values: readonly {
    severity: "error" | "warning" | "info";
    message: string;
    file: string;
    line: number;
    column: number;
    source: string;
    code?: string;
  }[],
): RuntimeDiagnostic[] {
  return values.map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
    source: diagnostic.source,
    code: diagnostic.code,
  }));
}

export function supportedRuntimeEnvironments(): Record<RuntimeEnvironment, boolean> {
  return {
    browser: true,
    node: false,
    vercel: false,
    "cloudflare-worker": false,
  };
}

/**
 * Construct the Forge-backed browser runtime.
 *
 * The browser host is intentionally the only default host until Forge exposes
 * a non-native embedded host for Node/serverless environments. No fallback
 * runtime is selected here.
 */
export async function createBrowserWasmRuntime(
  options: BrowserWasmRuntimeOptions = {},
): Promise<WasmRuntime> {
  const baseUrl = options.toolchainBaseUrl ?? DEFAULT_TOOLCHAIN_BASE_URL;

  const engine = await createBrowserEngine({
    artifactCache: options.artifactCache ?? false,
    toolchains: [
      rustSource(baseUrl),
      goSource(baseUrl),
    ],
  });

  return createEngineRuntime(engine);
}

export function createEngineRuntime(engine: Engine): WasmRuntime {
  let disposed = false;

  return {
    async execute(request) {
      if (disposed) {
        throw new Error("WASM runtime has been disposed.");
      }

      const started = performance.now();

      try {
        const result = await engine.execute(
          sourceProject(request.language, request.source, request.options ?? {}),
          {
            stdin: inputToStdin(request.inputs),
            args: [],
            env: {},
            determinism: {
              randomSeed: 0,
              realtimeEpochMs: 946684800000,
              clockStepNs: 1_000_000,
            },
            resources: {
              instructionBudget: 10_000_000,
              logicalTimeLimitMs: request.options?.timeoutMs ?? 10_000,
              memoryLimitBytes: 64 * 1024 * 1024,
              outputLimitBytes: 1024 * 1024,
              filesystemWriteLimitBytes: 1024 * 1024,
              filesystemEntryLimit: 128,
              wallTimeLimitMs: request.options?.timeoutMs ?? 10_000,
            },
          },
        );

        if (!result.run) {
          return {
            success: false,
            stdout: result.build.stdout,
            stderr: result.build.stderr,
            exitCode: 1,
            diagnostics: diagnostics(result.build.diagnostics),
            executionTimeMs: performance.now() - started,
          };
        }

        return {
          success: result.run.code === 0 && result.run.termination === "exited",
          stdout: result.run.stdout,
          stderr: result.run.stderr || result.run.trapMessage || "",
          exitCode: result.run.code,
          diagnostics: diagnostics(result.build.diagnostics),
          executionTimeMs: result.run.durationMs ?? performance.now() - started,
        };
      } catch (error) {
        return {
          success: false,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
          diagnostics: [],
          executionTimeMs: performance.now() - started,
        };
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      engine.dispose();
    },
  };
}

export async function createWasmRuntime(
  options: BrowserWasmRuntimeOptions = {},
): Promise<WasmRuntime> {
  return createBrowserWasmRuntime(options);
}
