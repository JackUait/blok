// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import type { Caller } from '../../../src/mcp/dispatcher';
import { startHttpServer } from '../../../src/mcp/http';
import { listMcpTools } from '../../../src/mcp/tools';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } },
};
const listCall = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'blok_list_documents', arguments: {} },
};
const post = (url: string, headers: Record<string, string> = {}, body: unknown = initialize): Promise<Response> => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
});

describe('startHttpServer', () => {
  const tools = listMcpTools(buildMcpContracts({ pageTitles: 'off' }).stored, { schema: 'envelope', handleIdleMs: 600_000 });
  const seen: Caller[] = [];
  const dispatch = vi.fn(async (_name: string, _args: Record<string, unknown>, caller: Caller) => {
    seen.push(caller);

    return { structuredContent: { documents: [], nextCursor: null, supported: false }, isError: false };
  });
  const servers: Array<{ url: string; close(): Promise<void> }> = [];
  const start = async (input: Omit<Parameters<typeof startHttpServer>[0], 'listen' | 'tools' | 'dispatch' | 'version'>): Promise<string> => {
    const server = await startHttpServer({ listen: '127.0.0.1:0', tools, dispatch, version: '0', ...input });

    servers.push(server);

    return server.url;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    seen.length = 0;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    vi.restoreAllMocks();
  });

  it('answers initialize on POST /mcp', async () => {
    const url = await start({ auth: { kind: 'none' }, principal: 'local' });
    const response = await post(`${url}/mcp`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('blok-mcp');
  });

  it('refuses a foreign Origin with 403 and allows a loopback one', async () => {
    const url = await start({ auth: { kind: 'none' }, principal: 'local' });

    expect((await post(`${url}/mcp`, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(`${url}/mcp`, { Origin: 'http://localhost:5173' })).status).toBe(200);
  });

  it('404s other paths', async () => {
    const url = await start({ auth: { kind: 'none' }, principal: 'local' });

    expect((await fetch(`${url}/other`)).status).toBe(404);
  });

  it('calls tools as the configured principal without auth', async () => {
    const url = await start({ auth: { kind: 'none' }, principal: 'local' });
    const response = await post(`${url}/mcp`, {}, listCall);

    expect(response.status).toBe(200);
    expect(seen[0]).toMatchObject({ principal: 'local', scopes: null });
  });

  describe('with OAuth', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = { kind: 'oauth' as const, issuer: 'https://id.test', audience: 'https://mcp.test', jwksUrl: 'https://id.test/jwks' };
    const jwks = vi.fn<typeof fetch>();
    const bearer = (scope: string): string => {
      const head = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url')}.${Buffer.from(JSON.stringify({
        iss: config.issuer, aud: config.audience, sub: 'user-42', scope, exp: Math.floor(Date.now() / 1000) + 600,
      })).toString('base64url')}`;

      return `${head}.${sign('sha256', Buffer.from(head), keys.privateKey).toString('base64url')}`;
    };
    let url = '';

    beforeEach(async () => {
      jwks.mockImplementation(async () => new Response(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1' }] })));
      url = await start({ auth: config, principal: 'unused', fetchImpl: jwks });
    });

    it('serves protected resource metadata', async () => {
      const response = await fetch(`${url}/.well-known/oauth-protected-resource`);

      expect(await response.json()).toEqual({
        resource: 'https://mcp.test',
        authorization_servers: ['https://id.test'],
        scopes_supported: ['blok.read', 'blok.write'],
        bearer_methods_supported: ['header'],
      });
    });

    it('401s without a token and names the metadata', async () => {
      const response = await post(`${url}/mcp`);

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('oauth-protected-resource');
    });

    it('401s a token with a bad signature', async () => {
      const token = bearer('blok.read');

      expect((await post(`${url}/mcp`, { Authorization: `Bearer ${token.slice(0, -4)}AAAA` })).status).toBe(401);
    });

    it('403s a token without blok.read', async () => {
      expect((await post(`${url}/mcp`, { Authorization: `Bearer ${bearer('other')}` })).status).toBe(403);
    });

    it('accepts a token with blok.read and passes its principal and scopes to tools', async () => {
      const response = await post(`${url}/mcp`, { Authorization: `Bearer ${bearer('blok.read blok.write')}` }, listCall);

      expect(response.status).toBe(200);
      expect(seen[0]).toMatchObject({ principal: 'user-42', scopes: ['blok.read', 'blok.write'] });
    });
  });
});
