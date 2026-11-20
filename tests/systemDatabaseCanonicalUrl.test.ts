import { describe, expect, it } from 'vitest';
import {
  normalizeSystemEnvironment, resolveSystemDatabaseUrlCandidates,
  resolveSystemDatabaseUrl, tryResolveSystemDatabaseUrl,
} from '../packages/backend/src/resolver/systemDatabaseUrl.js';

describe('canonical protected system database bootstrap', () => {
  it('prefers SYSTEM_DATABASE_URL_1 with optional fallbacks and de-duplicates connections', () => {
    const urls = resolveSystemDatabaseUrlCandidates({
      SYSTEM_DATABASE_URL_1: 'postgres://primary.invalid/db',
      SYSTEM_DATABASE_URL: 'postgres://legacy.invalid/db',
      SYSTEM_DATABASE_URL_2: 'postgres://primary.invalid/db',
      SYSTEM_DATABASE_URL_3: 'postgres://backup.invalid/db',
    });
    expect(urls).toEqual([
      'postgres://primary.invalid/db',
      'postgres://legacy.invalid/db',
      'postgres://backup.invalid/db',
    ]);
    expect(tryResolveSystemDatabaseUrl({ SYSTEM_DATABASE_URL_1: urls[0] })).toBe(urls[0]);
  });
  it('retains unsuffixed bindings for non-disruptive deployed workload migration', () => {
    expect(resolveSystemDatabaseUrl({
      SYSTEM_DATABASE_URL: 'postgres://legacy.invalid/db',
    })).toBe('postgres://legacy.invalid/db');
  });
  it('does not silently accept generic DATABASE_URL credentials', () => {
    expect(() => resolveSystemDatabaseUrl({
      DATABASE_URL: 'postgres://untrusted.invalid/db',
    })).toThrow('SYSTEM_DATABASE_URL_1');
  });
  it('normalizes canonical binding and does not overload APP_URL as identity', () => {
    const env = normalizeSystemEnvironment(
      { APP_URL: 'https://srkl.example.test', SYSTEM_DATABASE_URL_1: '  postgres://first.invalid/db  ' },
      { SYSTEM_DATABASE_URL: 'postgres://legacy.invalid/db' },
      'https://untrusted.example.test/api/config/v1',
    );
    expect(env.APP_URL).toBe('https://srkl.example.test');
    expect(env.SYSTEM_DATABASE_URL_1).toBe('postgres://first.invalid/db');
    expect(env.SYSTEM_DATABASE_URL).toBe('postgres://legacy.invalid/db');
  });
});
