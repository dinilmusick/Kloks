/**
 * @file env.ts
 * @description Runtime-neutral environment access and configuration validation.
 */
import type { ZodTypeAny } from "zod";

export type EnvironmentRecord = Readonly<Record<string, string | undefined>>;

interface NodeFileSystemAdapter {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: "utf8"): string;
}
interface NodePathAdapter {
  join(...parts: string[]): string;
}
interface NodeProcessAdapter {
  env: Record<string, string | undefined>;
  cwd(): string;
  getBuiltinModule?: (specifier: string) => unknown;
}

function runtimeEnvironment(): EnvironmentRecord {
  const runtime = globalThis as typeof globalThis & { process?: NodeProcessAdapter };
  return runtime.process?.env ?? {};
}

/** Read an environment value. Pass a Worker/provider env binding explicitly when outside Node. */
export function getEnv<T>(
  key: string,
  defaultValue?: T,
  environment: EnvironmentRecord = runtimeEnvironment(),
): T {
  const val = environment[key];
  if (val === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`[SkipoEnvError] Missing required environment variable: ${key}`);
  }
  if (typeof defaultValue === "number") {
    const num = Number(val);
    if (isNaN(num)) throw new Error(`[SkipoEnvError] Expected number for ${key}, received: ${val}`);
    return num as T;
  }
  if (typeof defaultValue === "boolean") return (val === "true" || val === "1") as T;
  try {
    if (defaultValue && typeof defaultValue === "object") return JSON.parse(val) as T;
  } catch {}
  return val as T;
}

/** Assert an environment value exists. */
export function requireEnv(key: string, environment: EnvironmentRecord = runtimeEnvironment()): string {
  const val = environment[key];
  if (val === undefined) throw new Error(`[SkipoEnvError] Missing required environment variable: ${key}`);
  return val;
}

/**
 * Node-only compatibility helper. It resolves built-ins lazily through Node's runtime
 * module registry so importing the portable functions entry never pulls fs/path into
 * browser or Worker dependency graphs. For provider runtimes, inject env bindings to
 * getEnv/requireEnv/validateEnvSchema instead of loading .env files.
 */
export function loadEnv(filePath?: string): void {
  const runtime = (globalThis as typeof globalThis & { process?: NodeProcessAdapter }).process;
  const getBuiltinModule = runtime?.getBuiltinModule;
  if (!runtime || typeof getBuiltinModule !== "function") {
    throw new Error("loadEnv() requires a Node.js runtime exposing process.getBuiltinModule().");
  }
  const fs = getBuiltinModule.call(runtime, "node:fs") as NodeFileSystemAdapter;
  const path = getBuiltinModule.call(runtime, "node:path") as NodePathAdapter;
  const file = filePath || path.join(runtime.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  try {
    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (runtime.env[key] === undefined) runtime.env[key] = value;
    }
  } catch {}
}

/** Validate the supplied environment using a Zod schema. */
export function validateEnvSchema<T extends ZodTypeAny>(
  zodSchema: T,
  environment: EnvironmentRecord = runtimeEnvironment(),
): T["_output"] {
  try {
    return zodSchema.parse(environment);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[SkipoEnvError] Environment validation failed: ${message}`);
  }
}

/** Checks if a connection string is a placeholder or template value. */
export function isPlaceholderConnection(url?: string): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim().toLowerCase();
  const placeholders = [
    "ep-sample", "example.com", "placeholder", "user:password@",
    "my_database", "your_password", "xxx.neon.tech", "username:password",
  ];
  return placeholders.some((placeholder) => trimmed.includes(placeholder));
}

/** Sanitize a database URL, returning undefined if empty or a placeholder. */
export function sanitizeDatabaseUrl(url?: string): string | undefined {
  if (!url || isPlaceholderConnection(url)) return undefined;
  return url.trim();
}
