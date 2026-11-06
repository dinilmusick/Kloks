import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GitHubAppConnector } from "./github-app-connector.js";

const response = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-github-request-id": "test-request" } });
const signer = async () => "test-jwt";

test("supports multiple installations and caches installation tokens", async () => {
  let tokenCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/access_tokens")) { tokenCalls++; return response(201, { token: "installation-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }); }
    return response(200, { ok: true });
  };
  const connector = new GitHubAppConnector({ installations: [
    { account: "primary", appId: 123, installationId: 1, privateKey: "test" },
    { account: "secondary", appId: 123, installationId: 2, privateKey: "test" },
  ], fetchImpl, signer });
  assert.deepEqual(connector.listAccounts(), ["primary", "secondary"]);
  assert.equal((await connector.getRepository("primary", "dinilmusick/Kloks")).ok, true);
  assert.equal((await connector.getRepository("primary", "dinilmusick/Kloks")).ok, true);
  assert.equal(tokenCalls, 1);
  assert.equal((await connector.getRepository("secondary", "dinilmusick/Kloks")).ok, true);
  assert.equal(tokenCalls, 2);
});

test("returns structured diagnostics for API failures", async () => {
  const fetchImpl: typeof fetch = async (input) => String(input).includes("/access_tokens")
    ? response(201, { token: "token", expires_at: new Date(Date.now() + 3600_000).toISOString() })
    : response(403, { message: "forbidden" });
  const connector = new GitHubAppConnector({ installations: [{ account: "primary", appId: 123, installationId: 1, privateKey: "test" }], fetchImpl, signer });
  const result = await connector.getRepository("primary", "private/repo");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.status, 403);
});

test("dispatches workflows and polls to a terminal run", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/access_tokens")) return response(201, { token: "token", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (url.includes("/dispatches")) return response(204, undefined);
    return response(200, { workflow_runs: [{ id: 7, status: "completed", conclusion: "success", created_at: "2026-11-06T17:00:00Z", updated_at: "2026-11-06T17:01:00Z" }] });
  };
  const connector = new GitHubAppConnector({ installations: [{ account: "primary", appId: 123, installationId: 1, privateKey: "test" }], fetchImpl, signer });
  assert.equal((await connector.dispatchWorkflow("primary", "dinilmusick/Kloks", "ci.yml", "main")).ok, true);
  const poll = await connector.pollWorkflow("primary", "dinilmusick/Kloks", "ci.yml", "main", "2026-11-06T16:59:00Z", { intervalMs: 1 });
  assert.equal(poll.ok, true);
  if (poll.ok) assert.equal(poll.data.id, 7);
});
