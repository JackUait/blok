import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHelperServer, DEFAULT_HELPER_PORT } from '../../../scripts/override/helper-server.mjs';

const TOKEN = 'test-token-123';

describe('override helper server', () => {
  let server: Server;
  let base: string;
  let runBuild: ReturnType<typeof vi.fn>;
  let current: { version: string };

  const start = async (): Promise<void> => {
    await new Promise<void>((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    current = { version: '1.10.1-dev.aaa' };
    runBuild = vi.fn(async () => {
      current = { version: '1.10.1-dev.bbb' };
    });
    server = createHelperServer({ token: TOKEN, runBuild, readCurrent: () => current });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise((resolveClose) => server.close(resolveClose));
  });

  it('exposes a stable default port for the extension to probe', () => {
    expect(DEFAULT_HELPER_PORT).toBe(41417);
  });

  it('answers preflight with CORS headers so the extension popup can call it', async () => {
    await start();
    const res = await fetch(`${base}/build`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('rejects requests without the token — any local page could POST otherwise', async () => {
    await start();
    const unauthed = await fetch(`${base}/status`);
    expect(unauthed.status).toBe(401);
    const wrong = await fetch(`${base}/build`, { method: 'POST', headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
    expect(runBuild).not.toHaveBeenCalled();
  });

  it('reports status with the current payload meta', async () => {
    await start();
    const res = await fetch(`${base}/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, building: false, current: { version: '1.10.1-dev.aaa' } });
  });

  it('builds on POST /build and returns the refreshed meta', async () => {
    await start();
    const res = await fetch(`${base}/build`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, current: { version: '1.10.1-dev.bbb' } });
    expect(runBuild).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent build requests into one build', async () => {
    let release: () => void = () => undefined;
    runBuild.mockImplementation(() => new Promise<void>((resolveBuild) => {
      release = () => {
        current = { version: '1.10.1-dev.ccc' };
        resolveBuild();
      };
    }));
    await start();

    const auth = { authorization: `Bearer ${TOKEN}` };
    const first = fetch(`${base}/build`, { method: 'POST', headers: auth });
    const second = fetch(`${base}/build`, { method: 'POST', headers: auth });
    await vi.waitFor(() => {
      expect(runBuild).toHaveBeenCalledTimes(1);
    });
    release();
    const bodies = await Promise.all([first, second].map(async (p) => await (await p).json() as unknown));
    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([
      { ok: true, current: { version: '1.10.1-dev.ccc' } },
      { ok: true, current: { version: '1.10.1-dev.ccc' } },
    ]);
  });

  it('surfaces build failures as a 500 without wedging later builds', async () => {
    runBuild.mockRejectedValueOnce(new Error('vite exploded'));
    await start();
    const auth = { authorization: `Bearer ${TOKEN}` };
    const failed = await fetch(`${base}/build`, { method: 'POST', headers: auth });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: 'vite exploded' });

    const retried = await fetch(`${base}/build`, { method: 'POST', headers: auth });
    expect(retried.status).toBe(200);
  });
});
