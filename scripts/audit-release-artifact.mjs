import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.KLOKS_PACKAGE_DIR || ".audit/package");
async function walk(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) result.push(...await walk(full));
    else if (item.isFile()) result.push(full);
  }
  return result;
}

const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.name !== "@ultrst-armada/kloks") throw new Error("Unexpected package name: " + manifest.name);
const files = await walk(root);
const suspicious = [];
for (const file of files.filter(file => /[.]m?js$/.test(file))) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (/JSON[.]stringify[ ]*[(][ ]*process[.]env|Object[.](?:entries|keys|values)[ ]*[(][ ]*process[.]env/.test(source)) {
    suspicious.push(relative + ": serializes the complete process environment");
  }
  if (/docustackAuthToken|depm_registered_users_db|admin@depm[.]vault|admin123|sess::/.test(source)) {
    suspicious.push(relative + ": contains the removed local credential/session authority");
  }
  if (/serviceId=cloudflare/i.test(source) && /[?&]token=/.test(source)) {
    suspicious.push(relative + ": forwards a Cloudflare token in a URL query string");
  }
}
if (suspicious.length) throw new Error("Release artifact security audit failed:\n" + suspicious.join("\n"));
console.log(JSON.stringify({ package: manifest.name + "@" + manifest.version, files: files.length, result: "artifact security checks passed" }, null, 2));
