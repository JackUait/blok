// @vitest-environment node
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPageStore, handlePageHostRequest, playgroundPageSeed, startPageHost, startPageHostNear } from '../../../scripts/dev-page-host.mjs';

type Store = ReturnType<typeof createPageStore>;

const SEED: NonNullable<Parameters<typeof createPageStore>[0]> = [
  { pageId: 'plan', title: 'Secret plan', icon: '📘', acl: { alice: 'write', bob: 'read' } },
];

const parse = (body: string | undefined): Record<string, unknown> => {
  const value: unknown = JSON.parse(body ?? '');

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`not an object: ${body}`);
  }

  return Object.fromEntries(Object.entries(value));
};

describe('handlePageHostRequest', () => {
  let store: Store;

  beforeEach(() => {
    store = createPageStore(SEED);
  });

  const request = (user: string | null, method: string, path: string, body?: unknown): ReturnType<typeof handlePageHostRequest> =>
    handlePageHostRequest({ store, user, method, path, body: body === undefined ? undefined : JSON.stringify(body) });

  it('answers a missing page with 404', () => {
    expect(request('alice', 'GET', '/pages/nope').status).toBe(404);
  });

  it('serves the record to a reader', () => {
    const response = request('bob', 'GET', '/pages/plan');

    expect(response.status).toBe(200);
    expect(parse(response.body)).toEqual({ pageId: 'plan', title: 'Secret plan', icon: '📘', version: 1 });
  });

  it('answers a denied user with access none and no title or icon bytes', () => {
    const response = request('carol', 'GET', '/pages/plan');

    expect(response.status).toBe(200);
    expect(parse(response.body)).toEqual({ pageId: 'plan', access: 'none' });
    expect(response.body).not.toContain('Secret plan');
    expect(response.body).not.toContain('📘');
  });

  it('treats a request without a user as denied', () => {
    expect(parse(request(null, 'GET', '/pages/plan').body)).toEqual({ pageId: 'plan', access: 'none' });
  });

  it('saves a title when the expected version is current, and bumps the version', () => {
    const response = request('alice', 'PUT', '/pages/plan/title', { title: 'Renamed', expectedVersion: 1 });

    expect(response.status).toBe(200);
    expect(parse(response.body)).toEqual({ pageId: 'plan', title: 'Renamed', icon: '📘', version: 2 });
    expect(response.broadcast).toEqual(['plan']);
    expect(parse(request('bob', 'GET', '/pages/plan').body).title).toBe('Renamed');
  });

  it('rejects a stale expected version with 409 and the current record, without writing', () => {
    request('alice', 'PUT', '/pages/plan/title', { title: 'First', expectedVersion: 1 });

    const response = request('alice', 'PUT', '/pages/plan/title', { title: 'Second', expectedVersion: 1 });

    expect(response.status).toBe(409);
    expect(parse(response.body)).toEqual({ pageId: 'plan', title: 'First', icon: '📘', version: 2 });
    expect(response.broadcast).toBeUndefined();
    expect(parse(request('alice', 'GET', '/pages/plan').body)).toMatchObject({ title: 'First', version: 2 });
  });

  it('refuses a title save without write access with 403 and no record bytes', () => {
    const response = request('bob', 'PUT', '/pages/plan/title', { title: 'Hijack', expectedVersion: 1 });

    expect(response.status).toBe(403);
    expect(response.body ?? '').not.toContain('Secret plan');
    expect(parse(request('alice', 'GET', '/pages/plan').body)).toMatchObject({ title: 'Secret plan', version: 1 });
  });

  it('does not tell a denied user the current title on a stale save', () => {
    const response = request('carol', 'PUT', '/pages/plan/title', { title: 'x', expectedVersion: 0 });

    expect(response.status).toBe(403);
    expect(response.body ?? '').not.toContain('Secret plan');
  });

  it('rejects a malformed title body with 400', () => {
    expect(request('alice', 'PUT', '/pages/plan/title', { title: 5, expectedVersion: 1 }).status).toBe(400);
    expect(handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/title', body: '{' }).status).toBe(400);
  });

  it('creates a page owned by its creator, with write access', () => {
    const response = request('carol', 'POST', '/pages', { pageId: 'fresh', title: 'Fresh' });

    expect(response.status).toBe(201);
    expect(parse(response.body)).toEqual({ pageId: 'fresh', title: 'Fresh', version: 1 });
    expect(request('carol', 'PUT', '/pages/fresh/title', { title: 'Mine', expectedVersion: 1 }).status).toBe(200);
    expect(parse(request('alice', 'GET', '/pages/fresh').body)).toEqual({ pageId: 'fresh', access: 'none' });
  });

  it('creates idempotently on pageId and never overwrites the record', () => {
    request('carol', 'POST', '/pages', { pageId: 'fresh', title: 'Fresh' });

    const again = request('carol', 'POST', '/pages', { pageId: 'fresh', title: 'Other' });

    expect(again.status).toBe(200);
    expect(parse(again.body)).toEqual({ pageId: 'fresh', title: 'Fresh', version: 1 });
  });

  it('does not reveal an existing page to a denied creator', () => {
    const response = request('carol', 'POST', '/pages', { pageId: 'plan', title: 'Mine now' });

    expect(response.status).toBe(200);
    expect(parse(response.body)).toEqual({ pageId: 'plan', access: 'none' });
    expect(parse(request('alice', 'GET', '/pages/plan').body)).toMatchObject({ title: 'Secret plan' });
  });

  it('changes access and announces only the page id', () => {
    const response = request('alice', 'PUT', '/pages/plan/acl', { user: 'bob', access: null });

    expect(response.status).toBe(200);
    expect(response.broadcast).toEqual(['plan']);
    expect(parse(request('bob', 'GET', '/pages/plan').body)).toEqual({ pageId: 'plan', access: 'none' });
    request('alice', 'PUT', '/pages/plan/acl', { user: 'bob', access: 'write' });
    expect(request('bob', 'PUT', '/pages/plan/title', { title: 'Bob', expectedVersion: 1 }).status).toBe(200);
  });

  it('falls back to a wildcard access entry', () => {
    store = createPageStore([{ pageId: 'open', title: 'Open', acl: { '*': 'read' } }]);

    expect(parse(request('anyone', 'GET', '/pages/open').body)).toMatchObject({ title: 'Open' });
    expect(request('anyone', 'PUT', '/pages/open/title', { title: 'x', expectedVersion: 1 }).status).toBe(403);
  });

  it('fails exactly the next targeted save once', () => {
    expect(request(null, 'POST', '/__faults', { user: 'alice', pageId: 'plan', failNextSave: true }).status).toBe(204);

    expect(request('bob', 'PUT', '/pages/plan/title', { title: 'x', expectedVersion: 1 }).status).toBe(403);
    expect(request('alice', 'PUT', '/pages/plan/title', { title: 'Lost', expectedVersion: 1 }).status).toBe(503);
    expect(parse(request('alice', 'GET', '/pages/plan').body)).toMatchObject({ title: 'Secret plan', version: 1 });
    expect(request('alice', 'PUT', '/pages/plan/title', { title: 'Kept', expectedVersion: 1 }).status).toBe(200);
  });

  it('delays the next targeted GET once, with the answer taken when it arrived', () => {
    request(null, 'POST', '/__faults', { user: 'bob', pageId: 'plan', delayNextGetMs: 500 });

    const delayed = request('bob', 'GET', '/pages/plan');

    // The record changes while the answer is held back; the held answer is stale.
    request('alice', 'PUT', '/pages/plan/title', { title: 'Changed', expectedVersion: 1 });

    expect(delayed.delayMs).toBe(500);
    expect(parse(delayed.body)).toMatchObject({ title: 'Secret plan', version: 1 });
    expect(request('bob', 'GET', '/pages/plan').delayMs).toBeUndefined();
  });

  it('delays allowed GETs for a user until cleared, but never a denial', () => {
    request(null, 'POST', '/__faults', { user: 'bob', pageId: 'plan', delayAllowedGetsMs: 800 });

    expect(request('bob', 'GET', '/pages/plan').delayMs).toBe(800);
    expect(request('alice', 'GET', '/pages/plan').delayMs).toBeUndefined();
    request('alice', 'PUT', '/pages/plan/acl', { user: 'bob', access: null });
    expect(request('bob', 'GET', '/pages/plan').delayMs).toBeUndefined();
    expect(parse(request(null, 'GET', '/__faults').body)).toMatchObject({ delayedGets: 1 });

    request(null, 'POST', '/__faults', { user: 'bob', pageId: 'plan', delayAllowedGetsMs: 0 });
    request('alice', 'PUT', '/pages/plan/acl', { user: 'bob', access: 'read' });
    expect(request('bob', 'GET', '/pages/plan').delayMs).toBeUndefined();
  });

  it('mutes a user\'s events until unmuted', () => {
    request(null, 'POST', '/__faults', { user: 'bob', muteEvents: true });

    expect(store.isMuted('bob')).toBe(true);
    expect(store.isMuted('alice')).toBe(false);
    request(null, 'POST', '/__faults', { user: 'bob', muteEvents: false });
    expect(store.isMuted('bob')).toBe(false);
  });

  it('answers a CORS preflight', () => {
    expect(request(null, 'OPTIONS', '/pages/plan/title').status).toBe(204);
  });

  it('answers an unknown route with 404 and a broken escape with 400', () => {
    expect(request('alice', 'GET', '/nowhere').status).toBe(404);
    expect(request('alice', 'GET', '/pages/%E0%A4%A').status).toBe(400);
  });
});

describe('startPageHost', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  /** Reads SSE frames until `count` data lines arrived. */
  const readEvents = async (url: string, count: number, during: () => Promise<void>): Promise<string[]> => {
    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });
    const body = response.body;

    if (body === null) {
      throw new Error('no event stream');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const lines: string[] = [];
    let text = '';

    await during();
    while (lines.length < count) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
      lines.splice(0, lines.length, ...text.split('\n').filter((line) => line.startsWith('data: ')));
    }
    controller.abort();

    return lines;
  };

  it('streams page ids, never titles, to every listener', async () => {
    const host = await startPageHost({ port: 0, seed: SEED });

    close = host.close;

    const put = (path: string, body: unknown): Promise<Response> => fetch(`${host.url}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-user': 'alice' },
      body: JSON.stringify(body),
    });

    const lines = await readEvents(`${host.url}/events?user=bob`, 2, async () => {
      expect((await put('/pages/plan/title', { title: 'Brand new name', expectedVersion: 1 })).status).toBe(200);
      expect((await put('/pages/plan/acl', { user: 'bob', access: null })).status).toBe(200);
    });

    expect(lines).toEqual(['data: {"pageId":"plan"}', 'data: {"pageId":"plan"}']);
    expect(lines.join('\n')).not.toContain('Brand new name');
  });

  it('sends CORS headers so another origin can call it', async () => {
    const host = await startPageHost({ port: 0, seed: SEED });

    close = host.close;

    const response = await fetch(`${host.url}/pages/plan`, { headers: { 'x-dev-user': 'bob' } });

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await response.json()).title).toBe('Secret plan');
  });

  it('answers a held GET later, and counts it once it is sent', async () => {
    const host = await startPageHost({ port: 0, seed: SEED });

    close = host.close;

    const call = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${host.url}${path}`, {
      method,
      headers: { 'x-dev-user': 'bob' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    await call('POST', '/__faults', { user: 'bob', pageId: 'plan', delayNextGetMs: 300 });

    const held = call('GET', '/pages/plan');
    const before = await (await call('GET', '/__faults')).json();
    const started = Date.now();

    expect((await held).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(before).toEqual({ delayedGets: 1, delayedSent: 0 });
    expect(await (await call('GET', '/__faults')).json()).toEqual({ delayedGets: 1, delayedSent: 1 });
  });

  it('closes while an event stream is open', async () => {
    const host = await startPageHost({ port: 0, seed: SEED });
    const controller = new AbortController();

    await fetch(`${host.url}/events?user=bob`, { signal: controller.signal });
    await expect(host.close()).resolves.toBeUndefined();
    controller.abort();
  });

  it('moves to the next port when the first is taken', async () => {
    const blocker = createServer();

    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));

    const address = blocker.address();

    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }

    try {
      const host = await startPageHostNear({ from: address.port, attempts: 5, seed: SEED });

      close = host.close;
      expect(new URL(host.url).port).not.toBe(String(address.port));
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

describe('playgroundPageSeed', () => {
  it('gives every playground page its title and icon, writable by everyone', () => {
    expect(playgroundPageSeed({ a: { title: 'A', icon: '🚀', parentId: null }, b: { parentId: 'a' } })).toEqual([
      { pageId: 'a', title: 'A', icon: '🚀', acl: { '*': 'write' } },
      { pageId: 'b', title: '', acl: { '*': 'write' } },
    ]);
  });
});
