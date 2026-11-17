import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { createQuickJsSmallScriptExecutor, type QuickJsModule } from './quickJsAdapter.js';
import { SmallScriptLimitError, type SmallScriptExecutor, type SmallScriptRequest } from './smallScript.js';

let interpreter: Promise<QuickJsModule> | undefined;

export async function loadInterpreter(): Promise<QuickJsModule> {
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
export function createWorkerQuickJsSmallScriptExecutor(): SmallScriptExecutor {
  return createQuickJsSmallScriptExecutor(loadInterpreter, () => performance.now());
}

const port = parentPort;
if (port) {
  const executor = createWorkerQuickJsSmallScriptExecutor();
  void loadInterpreter().then(() => {
    port.once('message', async (request: SmallScriptRequest) => {
      try {
        const value = await executor.execute(request);
        port.postMessage({ type: 'success', value });
      } catch (error) {
        const code = error instanceof SmallScriptLimitError ? error.code : 'SCRIPT_ERROR';
        const message = error instanceof SmallScriptLimitError ? error.message : 'JavaScript execution failed.';
        port.postMessage({ type: 'failure', code, message });
      }
    });
    port.postMessage({ type: 'ready' });
  }, () => {
    port.postMessage({ type: 'failure', code: 'EXECUTOR_UNAVAILABLE', message: 'Could not load QuickJS-WASM.' });
  });
}
