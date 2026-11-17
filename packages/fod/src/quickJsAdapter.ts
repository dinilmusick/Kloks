import type { SmallScriptExecutor, SmallScriptRequest } from './smallScript.js';
import { SmallScriptLimitError } from './smallScript.js';

/** Structural QuickJS API, intentionally independent of any WASM package.
 * A runtime-specific host loader supplies a precompiled WASM module:
 * - Cloudflare: use the bundler-imported WebAssembly.Module variant.
 * - Vercel Node/Edge: use a target-supported variant and verify host limits.
 * Bundling this module does not load QuickJS or any WASM until explicitly enabled.
 */
export interface QuickJsModule {
  newRuntime(): QuickJsRuntime;
}
interface QuickJsHandle { dispose(): void }
interface QuickJsContext {
  evalCode(code: string): { value?: QuickJsHandle; error?: QuickJsHandle };
  dump(handle: QuickJsHandle): unknown;
  dispose(): void;
}
interface QuickJsRuntime {
  setMemoryLimit(bytes: number): void;
  setMaxStackSize(bytes: number): void;
  setInterruptHandler(handler: () => boolean): void;
  newContext(): QuickJsContext;
  dispose(): void;
}

export function createQuickJsSmallScriptExecutor(load: () => Promise<QuickJsModule>): SmallScriptExecutor {
  return {
    async execute({ code, inputs, limits, signal }: SmallScriptRequest): Promise<unknown> {
      if (signal?.aborted) throw new SmallScriptLimitError('CANCELLED', 'Execution was cancelled.');
      const quickjs = await load();
      const runtime = quickjs.newRuntime();
      const started = Date.now();
      let checks = 0;
      let interrupted = false;
      let vm: QuickJsContext | undefined;
      try {
        runtime.setMemoryLimit(limits.heapBytes);
        runtime.setMaxStackSize(1024 * 1024);
        runtime.setInterruptHandler(() => {
          checks += 1;
          interrupted = Boolean(signal?.aborted) || checks > limits.maxInterruptChecks ||
            Date.now() - started >= limits.wallMs;
          return interrupted;
        });
        vm = runtime.newContext();
        // No host functions, process, network, filesystem or API credentials are installed.
        // Execute JS in QuickJS, NOT in the hosting Worker's/Node's JS realm.
        const wrapper = [
          '(function() { "use strict";',
          'const inputs = ' + JSON.stringify(inputs) + ';',
          'const result = (function() {',
          code,
          '})();',
          'if (result && typeof result.then === "function") throw new Error("ASYNC_NOT_SUPPORTED");',
          'const text = JSON.stringify(result);',
          'if (typeof text !== "string") throw new Error("INVALID_JSON_OUTPUT");',
          'return text;',
          '})()',
        ].join('\n');
        const result = vm.evalCode(wrapper);
        try {
          if (result.error) {
            const error = vm.dump(result.error) as {message?:string} | string | null;
            if (interrupted) throw new SmallScriptLimitError('SCRIPT_INTERRUPTED', 'JavaScript execution budget exhausted.');
            throw new SmallScriptLimitError('SCRIPT_ERROR', typeof error === 'string' ? error : String(error?.message || 'JavaScript execution failed.'));
          }
          if (!result.value) throw new SmallScriptLimitError('INVALID_JSON', 'JavaScript returned no JSON value.');
          const encoded = vm.dump(result.value);
          if (typeof encoded !== 'string') throw new SmallScriptLimitError('INVALID_JSON', 'JavaScript returned an invalid JSON value.');
          return JSON.parse(encoded) as unknown;
        } finally {
          result.error?.dispose();
          result.value?.dispose();
        }
      } finally {
        vm?.dispose();
        runtime.dispose();
      }
    },
  };
}
