import { beforeEach, expect, it, vi } from 'vitest';
import { queryUnifiedDb } from '../packages/backend/src/core/unifiedDb.js';
import { handleUiSessionRequest } from '../packages/backend/src/api/uiSession.js';

vi.mock('../packages/backend/src/core/unifiedDb.js', () => ({ queryUnifiedDb: vi.fn() }));

const db = vi.mocked(queryUnifiedDb);
const tab = '2743a144-98ac-4be0-a90b-f8868237d1cb';
const revision = '63599882-203c-43e1-a9c7-60322e1507b1';
const endpoint = 'https://example.test/api/ui-session/' + tab;
const owner = { appId: 'aiko', principalId: 'luth-user' };
const snapshot = { version: 1, components: [{ id: 'tiles', actions: ['select'] }] };

function post(operation: string, body: unknown, origin?: string): Request {
  return new Request(endpoint + '/' + operation, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => db.mockReset());

it('rejects unauthenticated and cross-origin access before requesting storage', async () => {
  expect((await handleUiSessionRequest(new Request(endpoint), { ...owner, principalId: '' }))?.status).toBe(401);
  expect((await handleUiSessionRequest(post('sync', { revision, snapshot }, 'https://other.test'), owner))?.status).toBe(403);
  expect(db).not.toHaveBeenCalled();
});

it('queues only an advertised action for the same user, tab, and revision', async () => {
  db.mockResolvedValueOnce({ rows: [{ snapshot }], rowCount: 1 });
  db.mockResolvedValueOnce({ rows: [{ revision }], rowCount: 1 });
  const response = await handleUiSessionRequest(post('action', {
    revision, componentId: 'tiles', controlId: 'select', payload: 'first',
  }), owner);
  expect(response?.status).toBe(202);
  expect(db.mock.calls[0]?.[1]).toEqual(['aiko:https://example.test', 'luth-user', tab, revision]);
  expect(JSON.parse(String(db.mock.calls[1]?.[1]?.[4]))).toMatchObject({
    revision, componentId: 'tiles', controlId: 'select', payload: 'first',
  });

  db.mockResolvedValueOnce({ rows: [{ snapshot }], rowCount: 1 });
  expect((await handleUiSessionRequest(post('action', { revision, componentId: 'tiles', controlId: 'setState' }), owner))?.status).toBe(409);
  expect(db).toHaveBeenCalledTimes(3);
});

it('returns unavailable when a tab is unknown or expired', async () => {
  db.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  expect((await handleUiSessionRequest(new Request(endpoint), owner))?.status).toBe(404);
  expect(db.mock.calls[0]?.[0]).toContain('expires_at>now()');
});
