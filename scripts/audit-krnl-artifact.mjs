import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.KRNL_PACKAGE_DIR || ".audit/krnl/package");
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
if (manifest.name !== "@ultrst-armada/krnl" || manifest.version !== "1.0.13") {
  throw new Error("Unexpected Krnl artifact: " + manifest.name + "@" + manifest.version);
}
const suspicious = [];
for (const file of (await walk(root)).filter(file => /[.]m?js$/.test(file))) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (/JSON[.]stringify[ ]*[(][ ]*process[.]env|Object[.](?:entries|keys|values)[ ]*[(][ ]*process[.]env/.test(source)) {
    suspicious.push(relative + ": serializes the process environment");
  }
  if (/process[.]env/.test(source) && /(?:http|https)[.](?:request|get)[ ]*[(]|fetch[ ]*[(]/.test(source)) {
    suspicious.push(relative + ": combines process environment access with network APIs");
  }
}
if (suspicious.length) throw new Error("Krnl artifact security audit failed:\n" + suspicious.join("\n"));
console.log(JSON.stringify({ package: manifest.name + "@" + manifest.version, result: "static checks passed" }, null, 2));
