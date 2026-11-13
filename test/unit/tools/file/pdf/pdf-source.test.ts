import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePdfSources } from '../../../../../src/tools/file/pdf/pdf-source';
import type { PdfSource } from '../../../../../src/tools/file/pdf/pdf-preview';

const URL_A = 'https://files.example.com/a.pdf';

const collect = async (sources: AsyncGenerator<PdfSource>): Promise<PdfSource[]> => {
  const out: PdfSource[] = [];
  for await (const source of sources) {
    out.push(source);
  }

  return out;
};

const text = (source: PdfSource | undefined): string =>
  (source?.kind === 'data' ? new TextDecoder().decode(source.data) : `<${source?.kind}>`);

describe('resolvePdfSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('without a hook tries the url itself', async () => {
    const sources = await collect(resolvePdfSources(URL_A, undefined, new AbortController().signal));

    expect(sources).toEqual([{ kind: 'url', url: URL_A }]);
  });

  it.each([
    ['a Blob', () => new Blob(['%PDF-blob'])],
    ['an ArrayBuffer', () => new TextEncoder().encode('%PDF-blob').buffer],
    ['a Response', () => new Response('%PDF-blob')],
  ])('turns the hook\'s %s into bytes, then still offers the url', async (_name, make) => {
    const hook = vi.fn(() => Promise.resolve(make()));

    const sources = await collect(resolvePdfSources(URL_A, hook, new AbortController().signal));

    expect(sources.map(text)).toEqual(['%PDF-blob', '<url>']);
    expect(hook).toHaveBeenCalledWith(URL_A, { signal: expect.any(AbortSignal) });
  });

  it('copies a host ArrayBuffer, so pdf.js never detaches the host\'s own buffer', async () => {
    const buffer = new TextEncoder().encode('%PDF-blob').buffer;

    const [first] = await collect(resolvePdfSources(URL_A, () => Promise.resolve(buffer), new AbortController().signal));

    expect(first?.kind === 'data' && first.data.buffer).not.toBe(buffer);
  });

  it('falls to the url when the hook throws', async () => {
    const hook = vi.fn(() => Promise.reject(new Error('no proxy')));

    const sources = await collect(resolvePdfSources(URL_A, hook, new AbortController().signal));

    expect(sources).toEqual([{ kind: 'url', url: URL_A }]);
  });

  it('falls to the url when the hook answers with an error status', async () => {
    const hook = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })));

    const sources = await collect(resolvePdfSources(URL_A, hook, new AbortController().signal));

    expect(sources).toEqual([{ kind: 'url', url: URL_A }]);
  });

  it('offers nothing for a url that is not http(s), and never shows it to the hook', async () => {
    const hook = vi.fn(() => Promise.resolve(new Blob(['%PDF-'])));

    const sources = await collect(resolvePdfSources('javascript:alert(1)', hook, new AbortController().signal));

    expect(sources).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
  });

  it('stops when the preview closes while the hook runs', async () => {
    const controller = new AbortController();
    const seen: { signal: AbortSignal | null } = { signal: null };
    const hook = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      seen.signal = init.signal;

      return new Promise<Blob>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const running = collect(resolvePdfSources(URL_A, hook, controller.signal));
    await Promise.resolve();

    controller.abort();

    expect(await running).toEqual([]);
    expect(seen.signal?.aborted).toBe(true);
  });
});
