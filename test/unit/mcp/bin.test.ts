// @vitest-environment node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
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
  // A pipe on macOS is async: process.exit drops what the pipe has not taken yet.
  it('writes all of a large answer before it exits on SIGTERM, even when the client reads slowly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-bin-'));
    const text = 'x'.repeat(1000);
    const blocks = Array.from({ length: 400 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', data: { text } }));

    dirs.push(dir);
    writeFileSync(join(dir, 'doc.json'), JSON.stringify({ blocks }));
    const child = spawn(process.execPath, [BIN, '--source', `files:${dir}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exit = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
    const lines: string[] = [];
    let buffered = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf-8');
      const parts = buffered.split('\n');

      buffered = parts.pop() ?? '';
      lines.push(...parts);
    });
    const answer = async (count: number): Promise<void> => {
      const deadline = Date.now() + 20_000;

      while (lines.length < count && Date.now() < deadline) {
        await sleep(20);
      }
    };
    const send = (message: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    };

    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bin-test', version: '0' } } });
    await answer(1);
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/call', params: { name: 'blok_open', arguments: { documentId: 'doc' } } });
    await answer(2);
    const handle: unknown = JSON.parse(lines[1]).result.structuredContent.handle;

    child.stdout.pause();
    // A read answer is capped, so three of them overfill the pipe.
    [3, 4, 5].forEach((id) => send({ id, method: 'tools/call', params: { name: 'blok_read', arguments: { handle } } }));
    await sleep(500);
    child.kill('SIGTERM');
    await sleep(500);
    child.stdout.resume();

    expect(await exit).toBe(0);
    expect(buffered).toBe('');
    expect(lines.slice(2).map((line): unknown => JSON.parse(line))).toMatchObject([3, 4, 5].map((id) => ({ id, result: { isError: false } })));
  }, TIMEOUT_MS);
});
