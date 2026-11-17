# FOD JavaScript nodes

The FOD runtime recognizes `system/javascript` and the older `custom/js-block` type. The source is stored in `node.data.code`. The script is synchronous, reads the JSON `inputs` object, and returns a JSON value. FOD connects that value to the node's `result` port and emits the usual execution events. Script errors carry stable codes in failure events and results.

Enable the interpreter explicitly from a Node.js backend.

```ts
import { FodRuntime } from '@ultrst-armada/kloks/fod';
import { createNodeQuickJsSmallScriptExecutor } from '@ultrst-armada/kloks/fod/quickjs-node';

const fod = new FodRuntime({
  workspaceId,
  workspaceService,
  scriptExecutor: createNodeQuickJsSmallScriptExecutor(),
});
await fod.executeFlow(flowId, { input: 42 }, { signal });
```

The opt-in export loads the QuickJS-WASM distribution. Each execution runs in a separate Node.js worker thread with an empty environment and a fresh interpreter runtime and context. The caller enforces a deadline and can terminate the thread for in-flight cancellation or if the interpreter misses an interrupt poll. The guest receives no host functions, module resolver, credentials, network, or filesystem. Guest dynamic evaluation and function constructors are disabled. Results cross the boundary as UTF-8-limited JSON. Guest exception contents are kept inside the interpreter.

The default ceiling is 8 KiB of UTF-8 source, 64 KiB each of JSON input and output, 32 MiB of interpreter heap, 100 ms of interpreter execution, and one attempt. QuickJS interrupt polls use a ceiling of 100,000 callbacks. These callbacks are sampled by QuickJS and do not count individual instructions. Cold module loading precedes the execution timer. The independent Node.js worker deadline covers request delivery and interpreter execution after loading. The interpreter also checks elapsed time at interrupt polls.

The ordinary FOD export does not load QuickJS. Hosts without an enabled adapter fail with `EXECUTOR_UNAVAILABLE`. The Node.js adapter targets the Node.js function runtime and must be deployed with the emitted worker, the QuickJS package, and its Wasm file. Cloudflare Workers freeze script-visible clocks during synchronous computation in production. Keep JavaScript nodes disabled there until a separately metered execution adapter has passed runtime and isolation checks. Vercel Edge also requires its own adapter and verification. Verify the full Cloudflare application Worker is below the ecosystem's 25 MiB uncompressed budget independently of the interpreter asset size.

## Capability authority and app composition

Skipo's application BackendFacade owns the caller-visible capability set. The Kloks FOD endpoint adapter maps those authorized operation descriptors to graph ports. The Kloks Aiko runtime uses the same descriptors to build endpoint and workflow agents. GutTS capabilities enter through registered service operations. User-composed grants narrow this set further. Floks renders the catalog and submits execution to the backend.

The authenticated HTTP and MCP entry points resolve Luth identity and workspace access before discovery. Each invocation, including nested workflow invocations and Aiko tool calls, must repeat authorization through the facade and validate arguments and results against the same operation schema. Neither an operation ID from a graph nor a model-generated tool selection confers permission. The QuickJS guest receives JSON data only and cannot call facade operations itself.

The existing Skipo module composition should auto-enable Aiko/FOD where the application mounts an editable Floks graph. Explicit enablement supports apps without such a graph. Explicit disablement is valid for apps without an editable graph, and excludes Aiko UI, routes, initialization, and interpreter dependencies while preserving the facade, HTTP, MCP, Settings, and Luth. Skipo must reject a disabled configuration when the editable graph is mounted.

A Node.js compatibility test exercises the packed library independently of the source checkout. Production certification also requires a Vercel Node artifact runtime test, Cloudflare validation on the actual application Worker with the selected execution adapter, and workspace-level limits on invocation rate and concurrent execution.
