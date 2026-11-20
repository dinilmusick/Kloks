import { parseUniversalConfigurationV1 } from '@dinilmusick/gutts/auth';
/**
 * Canonical application-side OAuth 2.1 backend-for-frontend (BFF).
 *
 * Luth is the single Better Auth authorization server. Applications never
 * receive Luth bearer/refresh tokens in JavaScript or redirect URLs. The BFF
 * owns PKCE, the code exchange, encrypted server-side tokens and an opaque,
 * first-party HttpOnly session cookie. Mount the same handler in every app.
 */
export interface OAuthBffDatabase {
  query(statement: string, values: readonly unknown[]): Promise<{ rows: any[] }>;
}

export interface OAuthBffConfig {
  /** Luth's exact Better Auth issuer, including /api/auth. */
  issuer: string;
  /** Exact, administratively verified Luth OAuth client and callback binding. */
  clientId: string;
  clientSecret: string;
  appId: string;
  redirectUri: string;
  /** Stable server-side secret, never serialized to a browser or log. */
  encryptionSecret: string;
  database: OAuthBffDatabase;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface OAuthBffUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export interface OAuthBffSession {
  authenticated: true;
  user: OAuthBffUser;
  session: { id: string; expiresAt: string };
}

const FLOW_MS = 10 * 60_000;
const SESSION_MS = 7 * 24 * 60 * 60_000;
const ACCESS_SKEW_MS = 30_000;
const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_CIPHERTEXT');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function nonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
}
async function keyFor(config: OAuthBffConfig): Promise<CryptoKey> {
  if (config.encryptionSecret.length < 32) throw new Error('OAUTH_BFF_SECRET_TOO_SHORT');
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode('kloks-oidc-bff-v1:' + config.encryptionSecret));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function seal(value: string, config: OAuthBffConfig): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(config), enc.encode(value));
  return base64url(iv) + '.' + base64url(new Uint8Array(ciphertext));
}
async function unseal(value: string, config: OAuthBffConfig): Promise<string> {
  const [iv, cipher, extra] = value.split('.');
  if (!iv || !cipher || extra) throw new Error('INVALID_CIPHERTEXT');
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(iv) as BufferSource },
    await keyFor(config),
    fromBase64url(cipher) as BufferSource,
  );
  return new TextDecoder().decode(result);
}
function exactCookie(request: Request, name: string): string | null {
  const found = (request.headers.get('cookie') ?? '').split(';').map(x => x.trim())
    .filter(x => x.startsWith(name + '='));
  if (found.length !== 1) return null;
  const token = found[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function sameValue(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function configOrigin(config: OAuthBffConfig): URL {
  const url = new URL(config.redirectUri);
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== 'https:' || issuer.pathname !== '/api/auth' || issuer.search || issuer.hash ||
      !config.clientId || !config.clientSecret || !config.appId ||
      url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
       ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('INVALID_VERIFIED_OAUTH_BFF_CONFIGURATION');
  }
  return url;
}
function cookieName(config: OAuthBffConfig, kind: 'flow' | 'session'): string {
  const secure = configOrigin(config).protocol === 'https:';
  return (secure ? '__Host-' : '') + 'ultrst_oidc_' + kind;
}
function cookie(config: OAuthBffConfig, kind: 'flow' | 'session', value: string, age: number): string {
  return cookieName(config, kind) + '=' + value + '; Path=/; HttpOnly; SameSite=Lax' +
    (configOrigin(config).protocol === 'https:' ? '; Secure' : '') + '; Max-Age=' + age;
}
function clearCookie(config: OAuthBffConfig, kind: 'flow' | 'session'): string {
  return cookie(config, kind, '', 0);
}
function localReturnTo(value: string | null, config: OAuthBffConfig): string {
  const target = value || '/';
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\') ||
      /[\x00-\x1f\x7f]/.test(target)) return '/';
  try {
    const resolved = new URL(target, configOrigin(config));
    if (resolved.origin !== configOrigin(config).origin) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch { return '/'; }
}
function reply(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function clientCredentials(config: OAuthBffConfig): URLSearchParams {
  return new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret });
}
async function exchange(config: OAuthBffConfig, body: URLSearchParams): Promise<{
  access_token: string; refresh_token?: string; expires_in: number;
}> {
  const response = await (config.fetcher || fetch)(config.issuer + '/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body, cache: 'no-store', redirect: 'manual',
  });
  if (!response.ok) throw new Error('LUTH_OAUTH_TOKEN_EXCHANGE_REJECTED');
  const data = await response.json() as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 || data.expires_in > 86400) {
    throw new Error('LUTH_OAUTH_INVALID_TOKEN_RESPONSE');
  }
  return { access_token: data.access_token, expires_in: data.expires_in,
    ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}) };
}
async function userInfo(config: OAuthBffConfig, token: string): Promise<OAuthBffUser | null> {
  const response = await (config.fetcher || fetch)(config.issuer + '/oauth2/userinfo', {
    headers: { authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'manual',
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('LUTH_OAUTH_USERINFO_UNAVAILABLE');
  const data = await response.json() as Record<string, unknown>;
  if (typeof data.sub !== 'string' || !data.sub ||
      typeof data.email !== 'string' || !data.email) throw new Error('LUTH_OAUTH_INVALID_PRINCIPAL');
  return { id: data.sub, email: data.email,
    name: typeof data.name === 'string' && data.name ? data.name : data.email,
    ...(typeof data.picture === 'string' ? { image: data.picture } : {}) };
}

/** The storage contract is in db/migrations/006_kloks_oidc_bff.sql. */
export function createOAuthBff(config: OAuthBffConfig) {
  configOrigin(config);
  const now = config.now || Date.now;
  const db = config.database;

  async function start(request: Request): Promise<Response> {
    if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url);
    const state = nonce(), verifier = nonce();
    const challenge = await sha256(verifier);
    await db.query(
      'INSERT INTO public.kloks_oidc_flows (state_hash,app_id,verifier_encrypted,redirect_uri,return_to,expires_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6)',
      [await sha256(state), config.appId, await seal(verifier, config), config.redirectUri,
        localReturnTo(url.searchParams.get('next'), config), new Date(now() + FLOW_MS).toISOString()],
    );
    const target = new URL(config.issuer + '/oauth2/authorize');
    for (const [key, value] of Object.entries({
      response_type: 'code', client_id: config.clientId,
      redirect_uri: config.redirectUri, scope: 'openid profile email offline_access',
      state, code_challenge: challenge, code_challenge_method: 'S256',
    })) target.searchParams.set(key, value);
    return new Response(null, { status: 303, headers: {
      location: target.toString(), 'set-cookie': cookie(config, 'flow', state, FLOW_MS / 1000),
      'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    } });
  }

  async function callback(request: Request): Promise<Response> {
    if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const expected = exactCookie(request, cookieName(config, 'flow'));
    if (!expected || !sameValue(state, expected) || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        url.searchParams.get('iss') !== config.issuer ||
        url.searchParams.getAll('iss').length !== 1 ||
        url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.getAll('code').length !== 1 ||
        !/^[A-Za-z0-9._~-]{16,2048}$/.test(code) ||
        url.searchParams.has('error')) {
      const response = reply({ error: 'OAUTH_CALLBACK_REJECTED' }, 400);
      response.headers.append('set-cookie', clearCookie(config, 'flow'));
      return response;
    }

    const flow = await db.query(
      'UPDATE public.kloks_oidc_flows SET consumed_at=clock_timestamp() ' +
      'WHERE state_hash=$1 AND app_id=$2 AND redirect_uri=$3 AND consumed_at IS NULL ' +
      'AND expires_at>clock_timestamp() RETURNING verifier_encrypted,return_to',
      [await sha256(state), config.appId, config.redirectUri],
    );
    if (flow.rows.length !== 1) return reply({ error: 'OAUTH_STATE_EXPIRED_OR_REPLAYED' }, 400);
    const verifier = await unseal(String(flow.rows[0].verifier_encrypted), config);
    const tokens = await exchange(config, new URLSearchParams({
      ...Object.fromEntries(clientCredentials(config)),
      grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier,
    }));
    const principal = await userInfo(config, tokens.access_token);
    if (!principal) return reply({ error: 'OAUTH_PRINCIPAL_REJECTED' }, 401);

    const opaque = nonce();
    const sessionId = crypto.randomUUID();
    await db.query(
      'INSERT INTO public.kloks_oidc_sessions ' +
      '(session_hash,session_id,app_id,principal_id,email,display_name,access_encrypted,refresh_encrypted,access_expires_at,expires_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [await sha256(opaque), sessionId, config.appId, principal.id, principal.email, principal.name ?? null,
        await seal(tokens.access_token, config), tokens.refresh_token ? await seal(tokens.refresh_token, config) : null,
        new Date(now() + tokens.expires_in * 1000).toISOString(),
        new Date(now() + SESSION_MS).toISOString()],
    );
    const location = new URL(localReturnTo(flow.rows[0].return_to, config), configOrigin(config));
    return new Response(null, { status: 303, headers: {
      location: location.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'set-cookie': cookie(config, 'session', opaque, SESSION_MS / 1000),
      // The flow cookie is overwritten by a subsequent attempt. Never reuse a consumed state.
    } });
  }

  async function getSession(request: Request): Promise<OAuthBffSession | null> {
    const opaque = exactCookie(request, cookieName(config, 'session'));
    if (!opaque) return null;
    const hash = await sha256(opaque);
    const found = await db.query(
      'SELECT session_id,principal_id,email,display_name,access_encrypted,refresh_encrypted,access_expires_at,expires_at,revision ' +
      'FROM public.kloks_oidc_sessions WHERE session_hash=$1 AND app_id=$2 AND revoked_at IS NULL ' +
      'AND expires_at>clock_timestamp() LIMIT 1',
      [hash, config.appId],
    );
    if (found.rows.length !== 1) return null;
    let row = found.rows[0];
    let token = await unseal(String(row.access_encrypted), config);
    if (new Date(row.access_expires_at).getTime() <= now() + ACCESS_SKEW_MS) {
      if (!row.refresh_encrypted) return null;
      const refreshed = await exchange(config, new URLSearchParams({
        ...Object.fromEntries(clientCredentials(config)), grant_type: 'refresh_token',
        refresh_token: await unseal(String(row.refresh_encrypted), config),
      }));
      const updated = await db.query(
        'UPDATE public.kloks_oidc_sessions SET access_encrypted=$1,refresh_encrypted=$2,access_expires_at=$3, ' +
        'revision=revision+1 WHERE session_hash=$4 AND app_id=$5 AND revision=$6 AND revoked_at IS NULL ' +
        'AND expires_at>clock_timestamp() RETURNING session_id,principal_id,email,display_name,expires_at',
        [await seal(refreshed.access_token, config),
          await seal(refreshed.refresh_token || await unseal(String(row.refresh_encrypted), config), config),
          new Date(now() + refreshed.expires_in * 1000).toISOString(), hash, config.appId, row.revision],
      );
      if (updated.rows.length !== 1) return null;
      row = updated.rows[0];
      token = refreshed.access_token;
    }
    // Luth validates the token on every protected request; the browser's cookie
    // alone never establishes a principal or workspace authorization.
    const current = await userInfo(config, token);
    if (!current || current.id !== row.principal_id || current.email !== row.email) return null;
    return { authenticated: true, user: current,
      session: { id: String(row.session_id), expiresAt: new Date(row.expires_at).toISOString() } };
  }

  async function session(request: Request): Promise<Response> {
    if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      const active = await getSession(request);
      return active ? reply(active, 200) : reply({ authenticated: false }, 401);
    } catch {
      // Temporary network outages must not erase the user's session cookie.
      return reply({ authenticated: false, error: 'LUTH_SESSION_UNAVAILABLE' }, 503);
    }
  }

  async function signOut(request: Request): Promise<Response> {
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (request.headers.get('origin') !== configOrigin(config).origin ||
        request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'ORIGIN_DENIED' }, 403);
    const opaque = exactCookie(request, cookieName(config, 'session'));
    if (opaque) {
      const hash = await sha256(opaque);
      const active = await db.query(
        'SELECT refresh_encrypted FROM public.kloks_oidc_sessions WHERE session_hash=$1 ' +
        'AND app_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1',
        [hash, config.appId],
      );
      // Local revocation is authoritative even if Luth's network is down.
      await db.query(
        'UPDATE public.kloks_oidc_sessions SET revoked_at=clock_timestamp() ' +
        'WHERE session_hash=$1 AND app_id=$2 AND revoked_at IS NULL', [hash, config.appId],
      );
      const token = active.rows[0]?.refresh_encrypted;
      if (typeof token === 'string' && token) {
        const revoke = await (config.fetcher || fetch)(config.issuer + '/oauth2/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            ...Object.fromEntries(clientCredentials(config)),
            token: await unseal(token, config),
            token_type_hint: 'refresh_token',
          }),
          cache: 'no-store', redirect: 'manual',
        }).catch(() => null);
        if (!revoke?.ok) {
          const failed = reply({ success: false, error: 'LUTH_REFRESH_TOKEN_REVOCATION_UNVERIFIED' }, 503);
          failed.headers.append('set-cookie', clearCookie(config, 'session'));
          return failed;
        }
      }
    }
    const response = reply({ success: true }, 200);
    response.headers.append('set-cookie', clearCookie(config, 'session'));
    return response;
  }

  /**
   * Authenticated same-origin configuration bridge.
   * Browser code never sees an OAuth access token or confidential client
   * credentials. The existing BFF verifies session + Luth userinfo first,
   * then uses its server-held token only against the pinned Luth config API.
   */
  async function configuration(request: Request): Promise<Response> {
    if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url);
    if (url.pathname !== '/api/initialization/config' || url.search || url.hash ||
        url.origin !== configOrigin(config).origin) {
      return reply({ error: 'INVALID_CONFIGURATION_REQUEST' }, 400);
    }
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site') {
      return reply({ error: 'ORIGIN_DENIED' }, 403);
    }
    try {
      const verified = await getSession(request);
      if (!verified) return reply({ error: 'AUTHENTICATION_REQUIRED' }, 401);
      const opaque = exactCookie(request, cookieName(config, 'session'));
      if (!opaque) return reply({ error: 'AUTHENTICATION_REQUIRED' }, 401);
      const found = await db.query(
        'SELECT principal_id,access_encrypted FROM public.kloks_oidc_sessions ' +
        'WHERE session_hash=$1 AND app_id=$2 AND principal_id=$3 ' +
        'AND revoked_at IS NULL AND expires_at>clock_timestamp() ' +
        'AND access_expires_at>clock_timestamp() LIMIT 1',
        [await sha256(opaque), config.appId, verified.user.id],
      );
      if (found.rows.length !== 1) return reply({ error: 'AUTHENTICATION_REQUIRED' }, 401);
      const token = await unseal(String(found.rows[0].access_encrypted), config);
      const endpoint = new URL('/api/config/v1', config.issuer);
      endpoint.searchParams.set('app_id', config.appId);
      const upstream = await (config.fetcher || fetch)(endpoint, {
        method: 'GET', cache: 'no-store', credentials: 'omit',
        redirect: 'error', headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
        },
      });
      if (!upstream.ok) {
        const status = upstream.status === 401 ? 401 :
          upstream.status === 403 ? 403 : 503;
        return reply({ error: status === 401 ? 'AUTHENTICATION_REQUIRED' :
          status === 403 ? 'AUTHORIZATION_DENIED' : 'CONFIG_UNAVAILABLE' }, status);
      }
      const payload = await upstream.json();
      const validated = parseUniversalConfigurationV1(payload, config.appId, verified.user.id);
      // Explicit projection also rejects excess top-level server metadata.
      return reply({
        protocol: validated.protocol, version: validated.version,
        application: validated.application,
        principal: { userId: verified.user.id }, workspaceId: validated.workspaceId,
        settings: {
          supportedServices: validated.settings.supportedServices,
          deploymentOrigin: validated.settings.deploymentOrigin,
          deploymentEnvironment: validated.settings.deploymentEnvironment,
        },
        cache: validated.cache,
      }, 200);
    } catch {
      // Never forward OAuth tokens, SQL errors or upstream internal messages.
      return reply({ error: 'CONFIG_UNAVAILABLE' }, 503);
    }
  }

  /** Routing is fixed, with no proxying of arbitrary Better Auth paths. */
  async function handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (path === '/api/initialization/config') return configuration(request);
    if (path === '/api/auth/oidc/start') return start(request);
    if (path === '/api/auth/oidc/callback') return callback(request);
    if (path === '/api/auth/oidc/session') return session(request);
    if (path === '/api/auth/oidc/logout') return signOut(request);
    return null;
  }

  return { start, callback, getSession, session, signOut, configuration, handle };
}
