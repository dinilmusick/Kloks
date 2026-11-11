import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { builtinModules } from 'node:module';

const dist = resolve(process.cwd(), 'packages/backend/dist');
const builtins = new Set(builtinModules.flatMap((name) => [name, 'node:' + name]));
const blocked = ['LocalFSAdapter', 'GoogleDriveAdapter', 'GoogleDriveOAuth',
  'WorkingWorkspaceService', 'nodeGraphPersistence', '/server/', '/core/',
  'unifiedDb', 'workspaceSyncEngine'];

function graph(entry: string) {
  const files = new Set<string>();
  const imports = new Set<string>();
  const pending = [resolve(dist, entry)];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  while (pending.length) {
    const file = pending.pop()!;
    if (files.has(file) || !existsSync(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (builtins.has(specifier)) imports.add(specifier);
        else if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (existsSync(target)) pending.push(target);
        }
      }
    }
  }
  return { files: [...files], builtins: [...imports] };
}

describe('Kloks portable and Node dependency graphs', () => {
  it('keeps portable backend exports free of Node built-ins and server adapters', () => {
    const result = graph('index.js');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.builtins).toEqual([]);
    for (const file of result.files) {
      for (const name of blocked) expect(file).not.toContain(name);
    }
  });

  it('retains Node filesystem capabilities behind explicit adapters', () => {
    const result = graph('node.js');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.builtins.some((name) => ['fs', 'node:fs'].includes(name))).toBe(true);
    expect(result.builtins.some((name) => ['path', 'node:path'].includes(name))).toBe(true);
  });

  it('publishes separate portable and Node adapter package exports', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'packages/backend/package.json'), 'utf8'));
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['./node'].import).toBe('./dist/node.js');
    expect(pkg.exports['./storage/node'].import).toBe('./dist/storage/node.js');
    expect(pkg.exports['./services/node'].import).toBe('./dist/services/node.js');
    expect(pkg.exports['./workspace/node'].import).toBe('./dist/workspace/node.js');
  });
});
