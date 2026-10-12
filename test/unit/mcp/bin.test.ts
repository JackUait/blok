// @vitest-environment node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BIN = resolve(__dirname, '../../../packages/mcp/bin/blok-mcp.mjs');
const DIST = resolve(__dirname, '../../../packages/mcp/dist/mcp.mjs');
// Spawns node and loads the whole bundle; slow under load.
const TIMEOUT_MS = 60_000;

const dirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

describe('blok-mcp binary', () => {
  it('dist/mcp.mjs exists (requires yarn build:mcp)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it('the bundle exports createBlokMcpServer', async () => {
    const bundle: unknown = await import(DIST);

    expect(typeof bundle === 'object' && bundle !== null && 'createBlokMcpServer' in bundle
      ? typeof bundle.createBlokMcpServer
      : undefined).toBe('function');
  });

  it('answers initialize on stdout with JSON-RPC only, and exits when stdin closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-bin-'));

    dirs.push(dir);
    const child = spawn(process.execPath, [BIN, '--source', `files:${dir}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bin-test', version: '0' } },
    })}\n`);

    await new Promise<void>((done, fail) => {
      const deadline = setTimeout(() => fail(new Error(`no initialize answer; stdout=${stdout} stderr=${stderr}`)), 20_000);

      child.stdout.on('data', () => {
        if (stdout.includes('\n')) {
          clearTimeout(deadline);
          done();
        }
      });
    });

    const exit = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));

    child.stdin.end();

    expect(await exit).toBe(0);

    const lines = stdout.split('\n').filter((line) => line !== '');

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    }
    expect(JSON.parse(lines[0])).toMatchObject({ id: 1, result: { serverInfo: { name: 'blok-mcp' } } });
  }, TIMEOUT_MS);
});
