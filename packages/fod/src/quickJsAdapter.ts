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
  typeof(handle: QuickJsHandle): string;
  getString(handle: QuickJsHandle): string;
  dispose(): void;
}
interface QuickJsRuntime {
  setMemoryLimit(bytes: number): void;
  setMaxStackSize(bytes: number): void;
  setInterruptHandler(handler: () => boolean): void;
  newContext(): QuickJsContext;
  dispose(): void;
}


const LOCK_DOWN = `
  for (const fn of [function () {}, async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', {
      value: undefined, writable: false, configurable: false,
    });
  }
  for (const name of ['eval', 'Function']) {
    Object.defineProperty(globalThis, name, {
      value: undefined, writable: false, configurable: false,
    });
  }
`;

/** The host clock must advance during synchronous Wasm execution. */
export function createQuickJsSmallScriptExecutor(
  load: () => Promise<QuickJsModule>,
  now: () => number = () => performance.now(),
): SmallScriptExecutor {
  return {
    async execute({ code, inputs, limits, signal }: SmallScriptRequest): Promise<unknown> {
      checkCancellation(signal);
      let quickjs: QuickJsModule;
      try {
        quickjs = await load();
      } catch {
        checkCancellation(signal);
        throw new SmallScriptLimitError('EXECUTOR_UNAVAILABLE', 'Isolated JavaScript interpreter could not be loaded.');
      }
      checkCancellation(signal);
      const started = now();
      const runtime = quickjs.newRuntime();
      let checks = 0;
      let interrupted = false;
      let vm: QuickJsContext | undefined;
      const checkBudget = () => {
        checkCancellation(signal);
        if (interrupted || now() - started >= limits.wallMs) {
          throw new SmallScriptLimitError('SCRIPT_INTERRUPTED', 'JavaScript execution budget exhausted.');
        }
      };
      try {
        runtime.setMemoryLimit(limits.heapBytes);
        runtime.setMaxStackSize(256 * 1024);
        runtime.setInterruptHandler(() => {
          checks += 1;
          interrupted ||= Boolean(signal?.aborted) || checks >= limits.maxInterruptChecks ||
            now() - started >= limits.wallMs;
          return interrupted;
        });
        vm = runtime.newContext();

        // Run hardening separately so user source cannot alter its parse scope.
        const setup = vm.evalCode(LOCK_DOWN);
        try {
          checkBudget();
          if (setup.error || !setup.value) {
            throw new SmallScriptLimitError('EXECUTOR_UNAVAILABLE', 'JavaScript sandbox initialization failed.');
          }
        } finally {
          setup.error?.dispose();
          setup.value?.dispose();
        }

        // Parse the input as JSON data. An object literal treats "__proto__" as syntax.
        const wrapper = [
          '(function () { "use strict";',
          'const stringify = JSON.stringify;',
          'const inputs = JSON.parse(' + JSON.stringify(JSON.stringify(inputs)) + ');',
          'const result = (function () {',
          code,
          '})();',
          'if (result && typeof result.then === "function") return undefined;',
          'return stringify(result, (_key, value) => {',
          '  if (value === undefined || typeof value === "function" || typeof value === "symbol" ||',
          '      (typeof value === "number" && !Number.isFinite(value))) throw new TypeError();',
          '  return value;',
          '});',
          '})()',
        ].join('\n');
        const result = vm.evalCode(wrapper);
        try {
          checkBudget();
          // Never inspect a guest exception, which may contain getters or proxies.
          if (result.error) {
            throw new SmallScriptLimitError('SCRIPT_ERROR', 'JavaScript execution failed.');
          }
          if (!result.value || vm.typeof(result.value) !== 'string') {
            throw new SmallScriptLimitError('INVALID_JSON', 'JavaScript must return synchronous JSON data.');
          }
          const encoded = vm.getString(result.value);
          checkBudget();
          if (new TextEncoder().encode(encoded).byteLength > limits.outputBytes) {
            throw new SmallScriptLimitError('PAYLOAD_TOO_LARGE', 'JavaScript output exceeds its byte budget.');
          }
          try {
            return JSON.parse(encoded) as unknown;
          } catch {
            throw new SmallScriptLimitError('INVALID_JSON', 'JavaScript returned invalid JSON.');
          }
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

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SmallScriptLimitError('CANCELLED', 'Execution was cancelled.');
}
