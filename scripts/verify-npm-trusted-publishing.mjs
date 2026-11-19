import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/npm-release.yml", "utf8");
const required = [
  "id-token: write",
  "registry-url: https://registry.npmjs.org/",
  "npm install --global npm@latest",
  "npm publish --provenance --access public",
  "workflow_run:",
];
for (const value of required) {
  if (!workflow.includes(value)) throw new Error("Missing Trusted Publishing requirement: " + value);
}
for (const forbidden of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken", "secrets.NPM"]) {
  if (workflow.includes(forbidden)) throw new Error("Long-lived npm token reference found: " + forbidden);
}
// Assert the same commit passed CI and is packed for independent consumption.
for (const required of [
  'ref: ${{ github.event.workflow_run.head_sha || github.sha }}',
  'test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"',
  'pnpm install --frozen-lockfile',
  'node scripts/clean-room-boundary.mjs',
  'npm pack --pack-destination',
  "steps.registry.outputs.exists == 'false'",
  "github.event.workflow_run.conclusion == 'success'",
]) {
  if (!workflow.includes(required)) throw new Error('Missing reproducible release gate: ' + required);
}
for (const forbidden of ['ref: main', 'pnpm install --no-frozen-lockfile', 'git push']) {
  if (workflow.includes(forbidden)) throw new Error('Unsafe release flow: ' + forbidden);
}
console.log("npm Trusted Publishing workflow contract verified.");
