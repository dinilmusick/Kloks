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
  if (relative === "packages/services/dist/index.js"
    && /process[.]env/.test(source)
    && /(?:http|https)[.](?:request|get)[ ]*[(]|fetch[ ]*[(]/.test(source)) {
    const envIndex = source.indexOf("process.env");
    const candidates = ["http.request", "https.request", "fetch("].map(value => source.indexOf(value)).filter(value => value >= 0);
    const networkIndex = candidates.length ? Math.min(...candidates) : envIndex;
    const start = Math.max(0, Math.min(envIndex, networkIndex) - 900);
    const end = Math.min(source.length, Math.max(envIndex, networkIndex) + 1800);
    suspicious.push(relative + ": combines process environment access with outbound network APIs; evidence=" + source.slice(start, end));
  }
  if (/serviceId=cloudflare/i.test(source) && /[?&]token=/.test(source)) {
    suspicious.push(relative + ": forwards a Cloudflare token in a URL query string");
  }
}
if (suspicious.length) throw new Error("Release artifact security audit failed:\n" + suspicious.join("\n"));
console.log(JSON.stringify({ package: manifest.name + "@" + manifest.version, files: files.length, result: "artifact static checks passed" }, null, 2));
