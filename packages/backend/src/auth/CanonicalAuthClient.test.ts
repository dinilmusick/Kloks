import { describe, expect, it } from 'vitest';
import { CanonicalAuthClient } from './CanonicalAuthClient.js';

describe('CanonicalAuthClient', () => {
  it('normalizes the canonical auth base URL and signs in through Better Auth', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        user: { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' },\n        url: 'https://auth.example.com/api/auth/callback/google',
        session: { token: 'session-token' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new CanonicalAuthClient({ baseUrl: 'https://auth.example.com/', fetcher: fetcher as typeof fetch });
    const result = await client.signInEmail(' User@Example.com ', 'password123');
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe('https://auth.example.com/api/auth/sign-in/email');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'user@example.com', password: 'password123' });
  });

  it('requests Google Drive incrementally instead of during Google identity sign-in', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ user: { id: 'u1', email: 'user@example.com', name: 'User' } }), { status: 200 });
    };
    const client = new CanonicalAuthClient({ baseUrl: 'https://auth.example.com', fetcher: fetcher as typeof fetch });
    await client.requestGoogleDriveAccess();
    expect(calls[0]).toBe('https://auth.example.com/api/auth/link-social');
  });
});
\n