import { performance } from 'node:perf_hooks';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { createQuickJsSmallScriptExecutor, type QuickJsModule } from './quickJsAdapter.js';
import { SmallScriptLimitError, type SmallScriptExecutor } from './smallScript.js';

let interpreter: Promise<QuickJsModule> | undefined;

async function loadInterpreter(): Promise<QuickJsModule> {
  if (globalThis.navigator?.userAgent?.includes('Cloudflare-Workers')) {
    throw new SmallScriptLimitError('EXECUTOR_UNAVAILABLE', 'The Node.js sandbox requires a host clock that advances during computation.');
  }

  // Emscripten reads the package's bundled Wasm once. Guests have no host IO imports.
  interpreter ??= newQuickJSWASMModuleFromVariant(releaseSync);
  try {
    return await interpreter;
  } catch (error) {
    interpreter = undefined;
    throw error;
  }
}

/** Opt-in adapter for Node.js hosts, including Vercel's Node.js function target. */
export function createNodeQuickJsSmallScriptExecutor(): SmallScriptExecutor {
  return createQuickJsSmallScriptExecutor(loadInterpreter, () => performance.now());
}
