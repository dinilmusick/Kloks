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

The opt-in export loads the QuickJS-WASM distribution. Each execution creates and disposes a separate interpreter runtime and context. The guest receives no host functions, module resolver, credentials, network, or filesystem. Guest dynamic evaluation and function constructors are disabled. Results cross the boundary as UTF-8-limited JSON. Guest exception contents are kept inside the interpreter.

The default ceiling is 8 KiB of UTF-8 source, 64 KiB each of JSON input and output, 32 MiB of interpreter heap, 100 ms of interpreter execution, and one attempt. QuickJS interrupt polls use a ceiling of 100,000 callbacks. These callbacks are sampled by QuickJS and do not count individual instructions. Cold module loading precedes the execution timer. Cancellation is checked before and after loading and at interpreter interrupts. Time and cancellation depend on the host's interrupt polling and the availability of a clock that advances during synchronous computation.

The ordinary FOD export does not load QuickJS. Hosts without an enabled adapter fail with `EXECUTOR_UNAVAILABLE`. The Node.js adapter targets the Node.js function runtime and must be deployed with the QuickJS package and its Wasm file. Cloudflare Workers freeze script-visible clocks during synchronous computation in production. Keep JavaScript nodes disabled there until a separately metered execution adapter has passed runtime and isolation checks. Vercel Edge also requires its own adapter and verification. Verify the full Cloudflare application Worker is below the ecosystem's 25 MiB uncompressed budget independently of the interpreter asset size.
