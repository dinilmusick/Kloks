import { createForgeWasmExecutor, type ForgeWasmExecutor } from "./executor.js";
import { resolveLanguage } from "./languageResolver.js";
import type {
  RuntimeEnvironment,
  RuntimeExecuteRequest,
  RuntimeResult,
  SupportedLanguage,
  WasmRuntime,
} from "./types.js";

const DEFAULT_TOOLCHAIN_BASE_URL = "/toolchains/";

export * from "./types.js";
export * from "./executor.js";
export * from "./languageResolver.js";
export * from "./toolchainResolver.js";

export function supportedRuntimeEnvironments(): Record<RuntimeEnvironment, boolean> {
  return {
    browser: true,
    node: false,
    vercel: false,
    "cloudflare-worker": false,
  };
}

export async function createBrowserWasmRuntime(
  toolchainBaseUrl = DEFAULT_TOOLCHAIN_BASE_URL,
): Promise<WasmRuntime> {
  const executor = await createForgeWasmExecutor(toolchainBaseUrl);
  return createRuntime(executor);
}

export async function createWasmRuntime(
  toolchainBaseUrl = DEFAULT_TOOLCHAIN_BASE_URL,
): Promise<WasmRuntime> {
  return createBrowserWasmRuntime(toolchainBaseUrl);
}

function createRuntime(executor: ForgeWasmExecutor): WasmRuntime {
  return {
    execute: async (request: RuntimeExecuteRequest): Promise<RuntimeResult> => {
      const resolution = resolveLanguage(request);
      return executor.execute(request, resolution.language);
    },
    dispose: () => executor.dispose(),
  };
}
