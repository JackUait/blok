import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Runtime from '../../../../../src/tools/file/pdf/pdf-runtime';

const options = vi.hoisted(() => ({ workerSrc: '' }));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: options }));

const runtime = async (): Promise<typeof Runtime> => import('../../../../../src/tools/file/pdf/pdf-runtime');

const workerFile = resolve(__dirname, '../../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');

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
  });

  it('the installed worker is self-contained: it has no relative static import', () => {
    expect(readFileSync(workerFile, 'utf8')).not.toMatch(/(?:\bfrom|\bimport)\s*["']\.{1,2}\//);
  });

  it('runs the worker from one blob URL, made once', async () => {
    const { boot } = await runtime();

    boot();
    boot();

    expect(options.workerSrc).toBe('blob:test/1');
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/javascript');
    expect(await blobs[0].text()).toBe(readFileSync(workerFile, 'utf8').replace(/\s*\/\/# sourceMappingURL=\S*\s*$/, ''));
  });
});
