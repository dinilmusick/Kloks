import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@neondatabase/serverless', () => {
  throw new Error('The optional Neon driver must not load during module initialization.');
});
import { cleanDbUrl, getUnifiedDbUrl } from './unifiedDb';
import { resolveSystemDatabaseUrl, tryResolveSystemDatabaseUrl } from '../resolver/systemDatabaseUrl';

const keys = ['SYSTEM_DATABASE_URL', 'SYSTEM_DATABASE_URL_1', 'SYSTEM_DATABASE_URL_2', 'SYSTEM_DATABASE_URL_3', 'DATABASE_URL'] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('canonical system database URL contract', () => {
  it('keeps the optional Neon driver lazy until a query executes', () => {
    expect(getUnifiedDbUrl({ SYSTEM_DATABASE_URL: 'postgresql://worker/db' })).toBe('postgresql://worker/db');
  });

  it('cleans quoted database URLs', () => {
    expect(cleanDbUrl('  "postgresql://primary/db"  ')).toBe('postgresql://primary/db');
  });

  it('prefers SYSTEM_DATABASE_URL over the supported failover URLs', () => {
    expect(getUnifiedDbUrl({
      SYSTEM_DATABASE_URL: 'postgresql://primary/db',
      SYSTEM_DATABASE_URL_2: 'postgresql://two/db',
      SYSTEM_DATABASE_URL_3: 'postgresql://three/db',
    })).toBe('postgresql://primary/db');
  });

  it('uses SYSTEM_DATABASE_URL_2 and then SYSTEM_DATABASE_URL_3 only when primary is absent', () => {
    expect(resolveSystemDatabaseUrl({ SYSTEM_DATABASE_URL_2: 'postgresql://two/db', SYSTEM_DATABASE_URL_3: 'postgresql://three/db' }))
      .toBe('postgresql://two/db');
    expect(resolveSystemDatabaseUrl({ SYSTEM_DATABASE_URL_3: 'postgresql://three/db' }))
      .toBe('postgresql://three/db');
  });

  it('does not use process.env to mask a missing explicit Worker binding', () => {
    const previous = process.env.SYSTEM_DATABASE_URL;
    process.env.SYSTEM_DATABASE_URL = 'postgresql://stale-node-value/db';
    expect(getUnifiedDbUrl({})).toBe('');
    if (previous === undefined) delete process.env.SYSTEM_DATABASE_URL;
    else process.env.SYSTEM_DATABASE_URL = previous;
  });

  it('uses process environment when no explicit runtime binding is supplied', () => {
    for (const key of keys) delete process.env[key];
    process.env.SYSTEM_DATABASE_URL_2 = 'postgresql://two/db';
    expect(getUnifiedDbUrl()).toBe('postgresql://two/db');
    process.env.SYSTEM_DATABASE_URL = 'postgresql://primary/db';
    expect(getUnifiedDbUrl()).toBe('postgresql://primary/db');
  });

  it('rejects legacy DATABASE_URL and SYSTEM_DATABASE_URL_1 aliases', () => {
    for (const key of keys) delete process.env[key];
    process.env.DATABASE_URL = 'postgresql://legacy/db';
    process.env.SYSTEM_DATABASE_URL_1 = 'postgresql://retired/db';
    expect(tryResolveSystemDatabaseUrl(process.env)).toBeNull();
    expect(getUnifiedDbUrl()).toBe('');
  });
});
