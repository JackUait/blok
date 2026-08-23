// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerRuntime } from '../../../scripts/build-server-runtime.mjs';

describe('buildServerRuntime', () => {
  let outDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outDir = mkdtempSync(join(tmpdir(), 'blok-server-runtime-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds one self-contained host script', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');

    expect(readdirSync(outDir)).toEqual(['blok-server-runtime.js']);
    expect(source).toContain('blokServerInvoke');
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});
