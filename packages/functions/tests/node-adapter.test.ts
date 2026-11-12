import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCache } from '../src/node.js';

describe('Node-only function adapters', () => {
  it('persists FileCache data without exposing filesystem imports from the portable entrypoint', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kloks-file-cache-'));
    try {
      const cache = new FileCache<{ value: number }>(directory);
      cache.set('item', { value: 42 });
      expect(cache.get('item')).toEqual({ value: 42 });
      cache.delete('item');
      expect(cache.get('item')).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
