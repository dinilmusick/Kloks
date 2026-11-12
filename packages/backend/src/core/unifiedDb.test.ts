import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@neondatabase/serverless', () => {
  throw new Error('The optional Neon driver must not load during module initialization.');
});
import { cleanDbUrl, getUnifiedDbUrl } from './unifiedDb';

const keys = ['SYSTEM_DATABASE_URL_1', 'SYSTEM_DATABASE_URL_2', 'SYSTEM_DATABASE_URL_3', 'DATABASE_URL'] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('system database URL contract', () => {
  it('keeps the optional Neon driver lazy until a query executes', () => {
    expect(getUnifiedDbUrl({ SYSTEM_DATABASE_URL_1: 'postgresql://worker/db' }))
      .toBe('postgresql://worker/db');
  });
  it('cleans quoted database URLs', () => {
    expect(cleanDbUrl('  "postgresql://primary/db"  ')).toBe('postgresql://primary/db');
  });

  it('prefers Worker binding URL 1, then 2, then 3', () => {
    expect(getUnifiedDbUrl({
      SYSTEM_DATABASE_URL_1: 'postgresql://one/db',
      SYSTEM_DATABASE_URL_2: 'postgresql://two/db',
      SYSTEM_DATABASE_URL_3: 'postgresql://three/db',
    })).toBe('postgresql://one/db');
    expect(getUnifiedDbUrl({
      SYSTEM_DATABASE_URL_2: 'postgresql://two/db',
      SYSTEM_DATABASE_URL_3: 'postgresql://three/db',
    })).toBe('postgresql://two/db');
    expect(getUnifiedDbUrl({ SYSTEM_DATABASE_URL_3: 'postgresql://three/db' }))
      .toBe('postgresql://three/db');
  });

  it('uses process environment URL 1, then 2, then 3', () => {
    for (const key of keys) delete process.env[key];
    process.env.SYSTEM_DATABASE_URL_2 = 'postgresql://two/db';
    process.env.SYSTEM_DATABASE_URL_3 = 'postgresql://three/db';
    expect(getUnifiedDbUrl()).toBe('postgresql://two/db');
    process.env.SYSTEM_DATABASE_URL_1 = 'postgresql://one/db';
    expect(getUnifiedDbUrl()).toBe('postgresql://one/db');
  });

  it('does not accept the legacy DATABASE_URL alias', () => {
    for (const key of keys) delete process.env[key];
    process.env.DATABASE_URL = 'postgresql://legacy/db';
    expect(getUnifiedDbUrl()).toBe('');
  });
});
