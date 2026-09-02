// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

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

  /**
   * The bundle is embedded in Blok.Server and executed by an engine that has
   * only the ECMAScript globals — no `atob`, no `Buffer`, no `TextDecoder`.
   * A dependency reaching for a host global fails at load, taking every
   * conversion with it, so the bundle is evaluated here in a realm with the
   * same nothing.
   */
  it('loads and converts in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;

    expect(typeof invoke).toBe('function');
    expect(await invoke('blocksToHtml', '{"blocks":[{"type":"paragraph","data":{"text":"Hi &amp; bye"}}]}'))
      .toBe('<p>Hi &amp; bye</p>');
  });

  it('keeps the previous bundle available while rebuilding', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const previous = readFileSync(outputPath);
    let rebuilding = true;
    let changedBeforeCompletion = false;
    const rebuild = buildServerRuntime(outDir).finally(() => {
      rebuilding = false;
    });

    while (rebuilding) {
      if (!existsSync(outputPath) || !readFileSync(outputPath).equals(previous)) {
        changedBeforeCompletion = true;
        break;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await rebuild;

    expect(changedBeforeCompletion).toBe(false);
  });
});
