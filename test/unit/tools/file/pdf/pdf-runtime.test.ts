import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Runtime from '../../../../../src/tools/file/pdf/pdf-runtime';

const options = vi.hoisted(() => ({ workerSrc: '' }));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: options }));

const runtime = async (): Promise<typeof Runtime> => import('../../../../../src/tools/file/pdf/pdf-runtime');

const PDFJS = resolve(__dirname, '../../../../../node_modules/pdfjs-dist');
const workerFile = resolve(PDFJS, 'legacy/build/pdf.worker.min.mjs');
const FALLBACKS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js'];
const fallbackSources = (): Record<string, string> =>
  Object.fromEntries(FALLBACKS.map((name) => [name, readFileSync(resolve(PDFJS, 'wasm', name), 'utf8')]));

/** node --check on a module file: true when it parses. */
const parses = (source: string): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-worker-'));
  try {
    writeFileSync(join(dir, 'worker.mjs'), source);
    execFileSync(process.execPath, ['--check', join(dir, 'worker.mjs')], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** WebAssembly that a CSP without 'wasm-unsafe-eval' leaves: compiling throws. */
const blockWasm = (): void => {
  vi.stubGlobal('WebAssembly', {
    ...WebAssembly,
    Module: class {
      constructor() {
        throw new WebAssembly.CompileError('blocked by CSP');
      }
    },
  });
};

describe('pdf.js runtime (lazy chunk)', () => {
  const blobs: Blob[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    options.workerSrc = '';
    blobs.length = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        blobs.push(blob);

        return `blob:test/${blobs.length}`;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('the installed worker is self-contained: it has no relative static import', () => {
    expect(readFileSync(workerFile, 'utf8')).not.toMatch(/(?:\bfrom|\bimport)\s*["']\.{1,2}\//);
  });

  it('runs the worker from one blob URL, made once', async () => {
    const { boot } = await runtime();

    await boot();
    await boot();

    expect(options.workerSrc).toBe('blob:test/1');
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/javascript');
    expect(await blobs[0].text()).toBe(readFileSync(workerFile, 'utf8').replace(/\s*\/\/# sourceMappingURL=\S*\s*$/, ''));
  });

  it('finds exactly one place where the installed worker loads a JS decoder', async () => {
    const { FALLBACK_IMPORT } = await runtime();

    // A pdfjs-dist upgrade that moves this breaks scans under a strict CSP.
    expect(readFileSync(workerFile, 'utf8').split(FALLBACK_IMPORT)).toHaveLength(2);
  });

  it('builds the JS decoders into the worker in place of that import', async () => {
    const { withFallbacks } = await runtime();

    const patched = withFallbacks(readFileSync(workerFile, 'utf8'), fallbackSources());

    expect(patched).not.toBeNull();
    expect(patched).not.toMatch(/\bimport\(/);
    expect(patched).not.toMatch(/^export default/m);
    expect(parses(patched ?? '')).toBe(true);
  });

  it('leaves the worker alone when the import is not where it was', async () => {
    const { withFallbacks } = await runtime();

    expect(withFallbacks('const a = 1;', fallbackSources())).toBeNull();
  });

  it('leaves the worker alone when a decoder is not one plain default export', async () => {
    const { withFallbacks } = await runtime();
    const sources = { ...fallbackSources(), 'jbig2_nowasm_fallback.js': 'import x from "./y.js"; export default x;' };

    expect(withFallbacks(readFileSync(workerFile, 'utf8'), sources)).toBeNull();
  });

  it('keeps the plain worker where wasm may run', async () => {
    const { boot, FALLBACK_IMPORT } = await runtime();

    await boot();

    expect(await blobs[0].text()).toContain(FALLBACK_IMPORT);
  });

  it('runs the worker with the JS decoders built in where the CSP blocks wasm', async () => {
    blockWasm();
    const { boot } = await runtime();

    await boot();

    const source = await blobs[0].text();
    expect(source).not.toMatch(/\bimport\(/);
    for (const code of Object.values(fallbackSources())) {
      expect(source).toContain(code.slice(code.indexOf('export default function') + 'export default '.length, 4000));
    }
  });
});
