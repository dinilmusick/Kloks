import { Worker } from 'node:worker_threads';
import { SmallScriptLimitError, type SmallScriptExecutor } from './smallScript.js';

type WorkerReply =
  | { type: 'ready' }
  | { type: 'success'; value: unknown }
  | { type: 'failure'; code: string; message: string };

/** Opt-in adapter for Node.js hosts with Worker thread support. */
export function createNodeQuickJsSmallScriptExecutor(): SmallScriptExecutor {
  return {
    execute({ signal, ...request }) {
      return new Promise((resolve, reject) => {
        const unavailable = () => new SmallScriptLimitError('EXECUTOR_UNAVAILABLE', 'Isolated JavaScript worker is unavailable.');
        const cancelled = () => new SmallScriptLimitError('CANCELLED', 'Execution was cancelled.');
        if (signal?.aborted) {
          reject(cancelled());
          return;
        }
        if (globalThis.navigator?.userAgent?.includes('Cloudflare-Workers')) {
          reject(unavailable());
          return;
        }

        let worker: Worker;
        try {
          worker = new Worker(new URL('./quickjs-worker.js', import.meta.url), { env: {}, execArgv: [] });
        } catch {
          reject(unavailable());
          return;
        }

        let settled = false;
        let running = false;
        let timer = setTimeout(() => finish(unavailable()), 5000);
        const abort = () => finish(cancelled());

        function finish(error?: SmallScriptLimitError, value?: unknown): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          // Reclaim the thread before returning so concurrent flows cannot leak workers on timeout.
          void worker.terminate().then(
            () => error ? reject(error) : resolve(value),
            () => reject(unavailable()),
          );
        }

        worker.on('error', () => finish(unavailable()));
        worker.on('exit', () => finish(unavailable()));
        worker.on('message', (reply: WorkerReply) => {
          if (settled) return;
          if (reply.type === 'ready' && !running) {
            running = true;
            clearTimeout(timer);
            timer = setTimeout(
              () => finish(new SmallScriptLimitError('SCRIPT_INTERRUPTED', 'JavaScript execution budget exhausted.')),
              request.limits.wallMs,
            );
            try {
              worker.postMessage(request);
            } catch {
              finish(new SmallScriptLimitError('INVALID_JSON', 'JavaScript input must be valid JSON.'));
            }
          } else if (reply.type === 'success' && running) {
            finish(undefined, reply.value);
          } else if (reply.type === 'failure') {
            finish(new SmallScriptLimitError(reply.code, reply.message));
          } else {
            finish(unavailable());
          }
        });
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
  };
}
