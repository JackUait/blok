import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Loader from '../../../../../src/tools/file/pdf/pdf-loader';

const boot = vi.fn();

vi.mock('../../../../../src/tools/file/pdf/pdf-runtime', () => ({
  boot: (): unknown => boot(),
}));

// jsdom has no canvas; supportsPdfJs only checks the context is not null.
const fakeContext = {} as CanvasRenderingContext2D;

const loader = async (): Promise<typeof Loader> => import('../../../../../src/tools/file/pdf/pdf-loader');

describe('pdf.js loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    boot.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads pdf.js once and hands every caller the same promise', async () => {
    const lib = { version: 'fake' };

    boot.mockReturnValue(lib);
    const { loadPdfJs } = await loader();

    const first = loadPdfJs();
    const second = loadPdfJs();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(lib);
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it('retries on the next call after a failed load', async () => {
    const lib = { version: 'fake' };

    boot.mockImplementationOnce(() => {
      throw new Error('chunk failed');
    }).mockReturnValue(lib);
    const { loadPdfJs } = await loader();

    await expect(loadPdfJs()).rejects.toThrow('chunk failed');
    await expect(loadPdfJs()).resolves.toBe(lib);
    expect(boot).toHaveBeenCalledTimes(2);
  });

  it('says no when the browser has no Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    const { supportsPdfJs } = await loader();

    expect(supportsPdfJs()).toBe(false);
  });

  it('says no when Promise.withResolvers is missing (the legacy build does not polyfill it)', async () => {
    vi.stubGlobal('Worker', function FakeWorker() {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext);
    const { supportsPdfJs } = await loader();
    const native = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');

    Reflect.deleteProperty(Promise, 'withResolvers');
    try {
      expect(supportsPdfJs()).toBe(false);
    } finally {
      if (native !== undefined) Object.defineProperty(Promise, 'withResolvers', native);
    }
  });

  it('says no without a 2d canvas', async () => {
    vi.stubGlobal('Worker', function FakeWorker() {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { supportsPdfJs } = await loader();

    expect(supportsPdfJs()).toBe(false);
  });

  it('says yes with a Worker, Promise.withResolvers and a 2d canvas', async () => {
    vi.stubGlobal('Worker', function FakeWorker() {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext);
    const { supportsPdfJs } = await loader();

    expect(supportsPdfJs()).toBe(true);
  });

  it('says no in plain jsdom', async () => {
    const { supportsPdfJs } = await loader();

    expect(supportsPdfJs()).toBe(false);
  });

  it('says wasm can run where the page allows it', async () => {
    const { canCompileWasm } = await loader();

    expect(canCompileWasm()).toBe(true);
  });

  it('says wasm cannot run where the CSP blocks it, and tries only once', async () => {
    const Module = vi.fn(function blocked() {
      throw new WebAssembly.CompileError('blocked by CSP');
    });
    vi.stubGlobal('WebAssembly', { ...WebAssembly, Module });
    const { canCompileWasm } = await loader();

    expect(canCompileWasm()).toBe(false);
    expect(canCompileWasm()).toBe(false);
    expect(Module).toHaveBeenCalledTimes(1);
  });
});
