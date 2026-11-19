// CI-only verification of the actual *published* npm registry tarball.
// This is historical-artifact evidence, not proof that current Git SHA built it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const root = process.cwd();
const current = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageName = process.env.PUBLIC_ARTIFACT_PACKAGE || current.name;
const packageVersion = process.env.PUBLIC_ARTIFACT_VERSION || current.version;
if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(packageName) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error("Invalid package name/version for registry verification");
}
const spec = packageName + "@" + packageVersion;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ultrst-registry-artifact-"));
const resultDir = path.join(root, "artifacts", "release-evidence");
fs.mkdirSync(resultDir, {recursive: true});
function exec(executable, args, cwd = root) {
  return execFileSync(executable, args, {cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: {
    ...process.env,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_PREFER_ONLINE: "true"
  }}).trim();
}
try {
  // npm performs its own registry/package integrity validation during pack.
  const dist = JSON.parse(exec("npm", ["view", spec, "dist", "--json"]));
  if (!dist || (!dist.integrity && !dist.shasum) || !dist.tarball?.startsWith("https://registry.npmjs.org/")) {
    throw new Error("Registry response lacks verifiable immutable archive metadata");
  }
  exec("npm", ["pack", spec, "--pack-destination", tmp, "--silent"]);
  const archiveName = fs.readdirSync(tmp).find(n => n.endsWith(".tgz"));
  if (!archiveName) throw new Error("npm pack failed to produce a downloadable tarball");
  const archive = path.join(tmp, archiveName);
  const bytes = fs.readFileSync(archive);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const sha1 = crypto.createHash("sha1").update(bytes).digest("hex");
  const integrity = "sha512-" + crypto.createHash("sha512").update(bytes).digest("base64");
  if (dist.integrity && integrity !== dist.integrity) throw new Error("Registry tarball SHA-512 SRI mismatch");
  if (dist.shasum && sha1 !== dist.shasum) throw new Error("Registry tarball SHA-1 mismatch");
  const entries = new Set(exec("tar", ["-tzf", archive]).split("\n").filter(Boolean));
  const manifestText = exec("tar", ["-xOzf", archive, "package/package.json"]);
  const published = JSON.parse(manifestText);
  if (published.name !== packageName || published.version !== packageVersion) {
    throw new Error("Packed manifest does not match exact requested npm identity");
  }
  if (!entries.has("package/package.json")) throw new Error("Packed manifest omitted");
  let checkedExports = 0;
  for (const [specifier, entry] of Object.entries(published.exports || {})) {
    if (specifier.includes("*")) continue;
    const paths = typeof entry === "string" ? [entry] : Object.values(entry || {}).filter(x => typeof x === "string");
    for (const output of paths) {
      if (!output.startsWith("./") || output.includes("*")) continue;
      const normalized = "package/" + output.slice(2);
      if (!entries.has(normalized)) throw new Error("Public npm tarball lacks export " + specifier + " -> " + normalized);
      checkedExports++;
    }
  }
  // Check the first available future patch without publishing or mutating manifests.
  // A network/auth/registry failure must never be interpreted as an unused version.
  const matched = /^(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(current.version);
  let nextUnusedPatch = null;
  if (matched) {
    for (let attempt = 1; attempt <= 30; attempt++) {
      const candidate = matched[1] + "." + matched[2] + "." + (Number(matched[3]) + attempt);
      try {
        exec("npm", ["view", current.name + "@" + candidate, "version", "--json"]);
      } catch (error) {
        const details = String(error.stderr || "") + String(error.message || "");
        if (!/E404|404 Not Found/.test(details)) {
          throw new Error("Unable to verify candidate uniqueness; no release recommendation: " + details.slice(0, 250));
        }
        nextUnusedPatch = candidate;
        break;
      }
    }
    if (!nextUnusedPatch) throw new Error("No unused patch version found within 30 checks");
  }
  const result = {
    schema: 1, kind: "historical-registry-artifact",
    packageName, packageVersion, sha256, sha512Integrity: integrity,
    checkedExports, archiveBytes: bytes.length, nextUnusedPatch,
    sourceVerificationCommit: process.env.EXPECTED_SHA || null,
    note: "Current checkout and registry artifact are distinct unless published provenance establishes the same commit."
  };
  fs.writeFileSync(path.join(resultDir, "published-npm-artifact.json"), JSON.stringify(result, null, 2) + "\n");
  console.log("PUBLIC NPM ARTIFACT VERIFIED: " + JSON.stringify(result));
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
