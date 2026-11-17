import { queryUnifiedDb } from '../core/unifiedDb.js';

const prefix = '/api/ui-session/';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const snapshotLimit = 256 * 1024;
const maxActionLength = 128;

type SessionRow = {
  revision: string;
  snapshot: unknown;
  command: unknown;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | null;
  updatedAt: string;
};

type UiSessionInput = {
  appId: string;
  principalId: string;
  env?: Record<string, unknown>;
};

const table = `CREATE TABLE IF NOT EXISTS ultrst_ui_sessions (
  scope text NOT NULL, principal text NOT NULL, tab uuid NOT NULL,
  revision uuid NOT NULL, snapshot jsonb NOT NULL, command jsonb, status text,
  expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, principal, tab)
)`;

function respond(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

function actionName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxActionLength;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body || !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > snapshotLimit) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    const parsed: unknown = JSON.parse(body);
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function advertised(snapshot: unknown, componentId: string, controlId: string): boolean {
  return record(snapshot) && Array.isArray(snapshot.components) && snapshot.components.some((component: unknown) =>
    record(component) && component.id === componentId &&
    Array.isArray(component.actions) && component.actions.includes(controlId));
}

function query(input: UiSessionInput) {
  return async (sql: string, params: unknown[]) => {
    try {
      return await queryUnifiedDb<SessionRow>(sql, params, input.env);
    } catch (error) {
      if ((error as { code?: string }).code !== '42P01') throw error;
      await queryUnifiedDb(table, [], input.env);
      return await queryUnifiedDb<SessionRow>(sql, params, input.env);
    }
  };
}

/** Call after the application's canonical Luth gate, with its verified principal. */
export async function handleUiSessionRequest(request: Request, input: UiSessionInput): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return;
  if (!input.principalId || !input.appId) return respond({ error: 'Authentication required' }, 401);
  const path = url.pathname.slice(prefix.length);
  const [tab, operation, extra] = path.split('/');
  if (!identifier(tab) || extra !== undefined || (operation && !['action', 'sync'].includes(operation))) {
    return respond({ error: 'Unknown UI session route' }, 404);
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return respond({ error: 'Cross-origin session access denied' }, 403);
  const scope = [input.appId + ':' + url.origin, input.principalId, tab];
  const run = query(input);
  const active = 'scope=$1 AND principal=$2 AND tab=$3 AND expires_at>now()';

  try {
    if (request.method === 'GET' && !operation) {
      const { rows: [row] } = await run(`SELECT revision, snapshot, command->>'id' AS "commandId", status,
        updated_at AS "updatedAt" FROM ultrst_ui_sessions WHERE ${active}`, scope);
      return row ? respond({ session: row }) : respond({ error: 'UI session is unavailable or expired' }, 404);
    }
    if (request.method === 'DELETE' && !operation) {
      await run('DELETE FROM ultrst_ui_sessions WHERE scope=$1 AND principal=$2 AND tab=$3', scope);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST' || !operation) return respond({ error: 'Unsupported method' }, 405);
    const body = await readBody(request);
    if (!body || !identifier(body.revision)) return respond({ error: 'Invalid UI session payload' }, 400);

    if (operation === 'action') {
      const { componentId, controlId, payload } = body;
      if (!actionName(componentId) || !actionName(controlId)) return respond({ error: 'Invalid action' }, 400);
      const { rows: [row] } = await run(`SELECT snapshot FROM ultrst_ui_sessions WHERE ${active} AND revision=$4`, [...scope, body.revision]);
      if (!row || !advertised(row.snapshot, componentId, controlId)) {
        return respond({ error: 'The action is unavailable for this snapshot' }, 409);
      }
      const id = crypto.randomUUID();
      const command = { id, revision: body.revision, componentId, controlId, payload };
      const result = await run(`UPDATE ultrst_ui_sessions SET command=$5, status='queued'
        WHERE ${active} AND revision=$4 AND (status IS NULL OR status IN ('succeeded','failed'))
        RETURNING revision`, [...scope, body.revision, JSON.stringify(command)]);
      return result.rowCount ? respond({ actionId: id }, 202) : respond({ error: 'Stale or busy UI session' }, 409);
    }

    if (!record(body.snapshot) || body.snapshot.version !== 1 || !Array.isArray(body.snapshot.components)) {
      return respond({ error: 'Invalid UI snapshot' }, 400);
    }
    const completion = record(body.completion) ? body.completion : undefined;
    if (completion && identifier(completion.id) && (completion.status === 'succeeded' || completion.status === 'failed')) {
      await run(`UPDATE ultrst_ui_sessions SET status=$5
        WHERE ${active} AND command->>'id'=$4 AND status='running'`, [...scope, completion.id, completion.status]);
    }

    await run(`DELETE FROM ultrst_ui_sessions WHERE scope=$1 AND principal=$2 AND expires_at<=now()`, scope.slice(0, 2));
    await run(`INSERT INTO ultrst_ui_sessions (scope,principal,tab,revision,snapshot,expires_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,now()+interval '20 seconds',now()) ON CONFLICT (scope,principal,tab) DO UPDATE SET
      revision=excluded.revision, snapshot=excluded.snapshot, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
    [...scope, body.revision, JSON.stringify(body.snapshot)]);
    const { rows: [delivery] } = await run(`UPDATE ultrst_ui_sessions SET status='running'
      WHERE ${active} AND status='queued' RETURNING command`, scope);
    return respond({ command: delivery?.command ?? null });
  } catch {
    return respond({ error: 'UI session storage unavailable' }, 503);
  }
}
