// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, deployPages, requestIdToken } from '../../../scripts/deploy-pages.mjs';

const SHA = 'a'.repeat(40);
const TREE = 't'.repeat(40);
const FRESH = 'f'.repeat(40);
const REPO = 'owner/repo';

interface Call { method: string; path: string; body?: Record<string, unknown> }

/** A fake GitHub API: answers by route, records every call. */
const fakeApi = (statuses: string[], overrides: Record<string, () => unknown> = {}) => {
  const calls: Call[] = [];
  const queue = [...statuses];
  const api = async (method: string, path: string, body?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const override = overrides[key];
    if (override) return override();
    if (key === `GET /repos/${REPO}/git/commits/${SHA}`) return { sha: SHA, tree: { sha: TREE } };
    if (key === `POST /repos/${REPO}/git/commits`) return { sha: FRESH };
    if (key === `POST /repos/${REPO}/pages/deployments`) {
      return { id: FRESH, page_url: 'https://example.com/', status_url: 'x' };
    }
    if (key === `GET /repos/${REPO}/pages/deployments/${FRESH}`) return { status: queue.shift() ?? 'deployment_in_progress' };
    if (key === `POST /repos/${REPO}/pages/deployments/${FRESH}/cancel`) return {};
    throw new Error(`unexpected ${key}`);
  };
  return { api, calls };
};

const base = {
  repo: REPO,
  sha: SHA,
  artifactId: '42',
  oidcToken: 'oidc',
  runId: '7',
  runAttempt: '2',
  sleep: async () => {},
  log: () => {},
};

describe('deployPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies the deployment by a commit made for this run, never by the run commit itself', async () => {
    const { api, calls } = fakeApi(['succeed']);

    const result = await deployPages({ ...base, api });

    const create = calls.find((call) => call.path === `/repos/${REPO}/pages/deployments` && call.method === 'POST');
    expect(create?.body?.pages_build_version).toBe(FRESH);
    expect(create?.body?.pages_build_version).not.toBe(SHA);
    expect(create?.body).toEqual({ artifact_id: 42, pages_build_version: FRESH, oidc_token: 'oidc' });

    const commit = calls.find((call) => call.path === `/repos/${REPO}/git/commits` && call.method === 'POST');
    expect(commit?.body).toMatchObject({ tree: TREE, parents: [SHA] });
    expect(commit?.body?.message).toContain('7');
    expect(result).toEqual({ id: FRESH, pageUrl: 'https://example.com/', buildVersion: FRESH });
  });

  it('polls the deployment id Pages answered with until it succeeds', async () => {
    const { api, calls } = fakeApi(['deployment_queued', 'deployment_in_progress', 'succeed']);

    await deployPages({ ...base, api });

    const polls = calls.filter((call) => call.method === 'GET' && call.path.includes('/pages/deployments/'));
    expect(polls.map((call) => call.path)).toEqual(Array(3).fill(`/repos/${REPO}/pages/deployments/${FRESH}`));
  });

  it.each(['deployment_failed', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost'])(
    'fails on the terminal status %s',
    async (status) => {
      const { api } = fakeApi([status]);

      await expect(deployPages({ ...base, api })).rejects.toThrow(status);
    },
  );

  it('creates no deployment when the commit cannot be written', async () => {
    const { api, calls } = fakeApi([], {
      [`POST /repos/${REPO}/git/commits`]: () => {
        throw new Error('POST git/commits answered 403: Resource not accessible');
      },
    });

    await expect(deployPages({ ...base, api })).rejects.toThrow('403');
    expect(calls.some((call) => call.path === `/repos/${REPO}/pages/deployments`)).toBe(false);
  });

  it('cancels the deployment and fails when it never finishes', async () => {
    const { api, calls } = fakeApi([]);
    let clock = 0;

    await expect(deployPages({
      ...base,
      api,
      timeoutMs: 1000,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    })).rejects.toThrow(/timed out/i);
    expect(calls.at(-1)).toEqual({ method: 'POST', path: `/repos/${REPO}/pages/deployments/${FRESH}/cancel`, body: undefined });
  });

  it('hands the created deployment to the caller before polling, so a signal can cancel it', async () => {
    const { api } = fakeApi(['succeed']);
    const seen: string[] = [];

    await deployPages({ ...base, api, onDeployment: (id: string) => seen.push(id) });

    expect(seen).toEqual([FRESH]);
  });
});

describe('createApi', () => {
  it('fails with the status and the response body', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"Not Found"}', { status: 404 }));
    const api = createApi({ baseUrl: 'https://api.github.test', token: 'tok', fetchImpl });

    await expect(api('POST', '/repos/o/r/pages/deployments', { a: 1 })).rejects.toThrow(
      'POST /repos/o/r/pages/deployments answered 404: {"message":"Not Found"}',
    );
  });

  it('sends the token and a JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const api = createApi({ baseUrl: 'https://api.github.test', token: 'tok', fetchImpl });

    await expect(api('POST', '/x', { a: 1 })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.test/x', expect.objectContaining({
      method: 'POST',
      body: '{"a":1}',
      headers: expect.objectContaining({ authorization: 'Bearer tok' }),
    }));
  });
});

describe('requestIdToken', () => {
  it('mints the OIDC token the way the Actions toolkit does', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"value":"jwt"}', { status: 200 }));

    await expect(requestIdToken({ url: 'https://token.test/?x=1', token: 'req', fetchImpl })).resolves.toBe('jwt');
    expect(fetchImpl).toHaveBeenCalledWith('https://token.test/?x=1', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer req' }),
    }));
  });

  it('fails when the job was granted no id-token permission', async () => {
    await expect(requestIdToken({ url: '', token: '', fetchImpl: vi.fn() })).rejects.toThrow(/id-token/);
  });
});
