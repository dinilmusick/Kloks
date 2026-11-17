/** Host-independent contract for the opt-in small-JavaScript workflow node.
 * No host eval/Function, Node APIs, or interpreter payload is imported here.
 * The interpreter must interrupt itself; a Promise timeout cannot stop a JS loop.
 */
export interface SmallScriptLimits {
  sourceBytes: number;
  inputBytes: number;
  outputBytes: number;
  heapBytes: number;
  wallMs: number;
  maxInterruptChecks: number;
  maxAttempts: 1;
}

export const DEFAULT_SMALL_SCRIPT_LIMITS: Readonly<SmallScriptLimits> = Object.freeze({
  sourceBytes: 8 * 1024,
  inputBytes: 64 * 1024,
  outputBytes: 64 * 1024,
  heapBytes: 32 * 1024 * 1024,
  wallMs: 100,
  // QuickJS interrupt callbacks are not one callback per JS instruction.
  maxInterruptChecks: 100_000,
  maxAttempts: 1,
});

export class SmallScriptLimitError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SmallScriptLimitError';
  }
}

export interface SmallScriptRequest {
  code: string;
  inputs: Record<string, unknown>;
  limits: Readonly<SmallScriptLimits>;
  signal?: AbortSignal;
}

export interface SmallScriptExecutor {
  /** Trusted host adapter; must enforce heap, time, and interrupt limits itself. */
  execute(request: SmallScriptRequest): Promise<unknown>;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Sanitizes values through the JSON boundary; functions, cycles and oversized values are rejected. */
export function jsonBoundary(value: unknown, maxBytes: number, label: string): unknown {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); }
  catch { throw new SmallScriptLimitError('INVALID_JSON', label + ' must be valid JSON.'); }
  if (encoded === undefined) throw new SmallScriptLimitError('INVALID_JSON', label + ' must be JSON serializable.');
  if (utf8Length(encoded) > maxBytes) {
    throw new SmallScriptLimitError('PAYLOAD_TOO_LARGE', label + ' exceeds ' + maxBytes + ' bytes.');
  }
  const decoded: unknown = JSON.parse(encoded);
  return decoded;
}

/** Does not execute untrusted code when the host has no verified interpreter. */
export async function executeSmallScript(
  executor: SmallScriptExecutor | undefined,
  code: unknown,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  limits: Readonly<SmallScriptLimits> = DEFAULT_SMALL_SCRIPT_LIMITS,
): Promise<unknown> {
  if (!executor) throw new SmallScriptLimitError('EXECUTOR_UNAVAILABLE', 'Isolated JavaScript executor is not configured.');
  if (typeof code !== 'string' || !code.trim()) {
    throw new SmallScriptLimitError('INVALID_SCRIPT', 'JavaScript source must be a non-empty string.');
  }
  if (utf8Length(code) > limits.sourceBytes) {
    throw new SmallScriptLimitError('SCRIPT_TOO_LARGE', 'JavaScript source exceeds ' + limits.sourceBytes + ' UTF-8 bytes.');
  }
  if (signal?.aborted) throw new SmallScriptLimitError('CANCELLED', 'Execution was cancelled.');
  const cleanInputs = jsonBoundary(input, limits.inputBytes, 'JavaScript input') as Record<string, unknown>;
  // The engine invokes exactly once; node retries require a separate audited invocation.
  const output = await executor.execute({ code, inputs: cleanInputs, limits, signal });
  return jsonBoundary(output, limits.outputBytes, 'JavaScript output');
}
