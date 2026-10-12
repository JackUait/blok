// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BIN = resolve(__dirname, '../../../packages/mcp/bin/blok-mcp.mjs');
const GUARD = resolve(__dirname, '../../../packages/mcp/dist/stdout-guard.mjs');
const dirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  try {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    vi.restoreAllMocks();
  }
});

describe('blok-mcp bin import order', () => {
  it('guards module-load logs before importing the CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-import-order-'));

    dirs.push(dir);

    const binDir = join(dir, 'bin');
    const distDir = join(dir, 'dist');
    const copiedBin = join(binDir, 'blok-mcp.mjs');
    const frame = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n';

    mkdirSync(binDir);
    mkdirSync(distDir);
    copyFileSync(BIN, copiedBin);
    copyFileSync(GUARD, join(distDir, 'stdout-guard.mjs'));
    writeFileSync(join(distDir, 'mcp.mjs'), [
      "console.log('module-load diagnostic');",
      'export const runCli = async () => {',
      '  process.stdout.write(' + JSON.stringify(frame) + ');',
      '};',
      '',
    ].join('\n'));

    const result = spawnSync(process.execPath, [copiedBin], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    });

    expect(result.stdout).toBe(frame);
    expect(result.stderr).toBe('module-load diagnostic\n');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
  }, 30_000);
});
