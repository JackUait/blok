import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderFileCard } from '../../../../../src/tools/file/ui';
import { mountCardObject, type CardLabels } from '../../../../../src/tools/file/card';

const labels: CardLabels = {
  pages: '{count} pages', pagesOne: '1 page',
  sheets: '{count} sheets', sheetsOne: '1 sheet',
  slides: '{count} slides', slidesOne: '1 slide',
  lines: '{count} lines', linesOne: '1 line',
  files: '{count} files', filesOne: '1 file',
};

const text = (body: string): Response => new Response(new TextEncoder().encode(body));

function mount(data: { url: string; fileName?: string; size?: number }): { wrapper: HTMLElement; teardown: () => void } {
  const wrapper = renderFileCard(data);
  document.body.appendChild(wrapper);

  return { wrapper, teardown: mountCardObject(wrapper, { data, config: {}, labels }) };
}

const stageOf = (wrapper: HTMLElement): HTMLElement | null => wrapper.querySelector<HTMLElement>('[data-role="file-object"]');
const sizeOf = (wrapper: HTMLElement): string | null => wrapper.querySelector('[data-role="file-size"]')?.textContent ?? null;

describe('mountCardObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no IntersectionObserver, so the card reads its file at once.
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows nothing until the file is read, then an editor tab with its real first lines', async () => {
    const gate: { open: (response: Response) => void } = { open: () => undefined };
    const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => {
      gate.open = resolve;
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const { wrapper } = mount({ url: 'https://cdn/a.ts', fileName: 'a.ts', size: 2048 });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(stageOf(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('data-file-object')).toBe(false);

    gate.open(text('const a = 1;\n'));
    await vi.waitFor(() => expect(stageOf(wrapper)).not.toBeNull());

    expect(wrapper.getAttribute('data-file-object')).toBe('code');
    expect(wrapper.querySelector('[data-role="file-object-code"]')?.textContent).toBe('const a = 1;');
    expect(stageOf(wrapper)?.parentElement?.className).toBe('blok-file-card');
  });

  it('puts the count before the size once the file is read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(text('a\nb\nc\n')));
    const { wrapper } = mount({ url: 'https://cdn/a.ts', fileName: 'a.ts', size: 2048 });

    await vi.waitFor(() => expect(sizeOf(wrapper)).toBe('3 lines · 2 KB'));
  });

  it('shows the count alone when the size is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(text('only\n')));
    const { wrapper } = mount({ url: 'https://cdn/a.ts', fileName: 'a.ts' });

    await vi.waitFor(() => expect(sizeOf(wrapper)).toBe('1 line'));
  });

  it('keeps the plain card when the file cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));
    const { wrapper } = mount({ url: 'https://cdn/a.ts', fileName: 'a.ts', size: 2048 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stageOf(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('data-file-object')).toBe(false);
    expect(sizeOf(wrapper)).toBe('2 KB');
  });

  it('shows a folder at once for an archive, and fills in its file count when known', async () => {
    const tail = new Uint8Array(22);
    const view = new DataView(tail.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(10, 38, true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tail, { status: 206 })));
    const { wrapper } = mount({ url: 'https://cdn/brand-assets.zip', fileName: 'brand-assets.zip', size: 1024 });

    expect(wrapper.getAttribute('data-file-object')).toBe('archive');
    const stage = stageOf(wrapper);
    expect(wrapper.querySelector('[data-role="file-object-title"]')?.textContent).toBe('Brand assets');

    await vi.waitFor(() => expect(wrapper.querySelector('[data-role="file-object-detail"]')?.textContent).toBe('38 files'));
    expect(sizeOf(wrapper)).toBe('38 files · 1 KB');
    // The folder is filled in, not rebuilt.
    expect(stageOf(wrapper)).toBe(stage);
  });

  it('shows a punch card at once for an unknown file, and re-punches it from the real bytes', async () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
    const { wrapper } = mount({ url: 'https://cdn/backup.bin', fileName: 'backup.bin' });
    const head = (): string | null => wrapper.querySelector('[data-role="file-object-punch-head"]')?.textContent ?? null;

    expect(head()).toBe('BACKUP · 0000 0001 0002 0003 0004 0005 0006');
    await vi.waitFor(() => expect(head()).toBe('BACKUP · 0003 0609 0C0F 1215 181B 1E21 2427'));
    expect(wrapper.querySelectorAll('[data-role="file-object"]')).toHaveLength(1);
  });

  it('marks the object hot while the pointer is over the card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 404 })));
    const { wrapper } = mount({ url: 'https://cdn/a.zip', fileName: 'a.zip' });
    const stage = stageOf(wrapper);

    wrapper.dispatchEvent(new MouseEvent('pointerenter'));
    expect(stage?.hasAttribute('data-hot')).toBe(true);

    wrapper.dispatchEvent(new MouseEvent('pointerleave'));
    expect(stage?.hasAttribute('data-hot')).toBe(false);
  });

  it('plays the arrow drop on the download button, and ends it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 404 })));
    const { wrapper } = mount({ url: 'https://cdn/a.zip', fileName: 'a.zip' });
    const download = wrapper.querySelector<HTMLElement>('.blok-file-download');
    download?.addEventListener('click', (event) => event.preventDefault());

    download?.click();
    expect(download?.hasAttribute('data-dropping')).toBe(true);

    vi.advanceTimersByTime(800);
    expect(download?.hasAttribute('data-dropping')).toBe(false);
    vi.useRealTimers();
  });

  describe('teardown', () => {
    it('removes the object and the marker', () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 404 })));
      const { wrapper, teardown } = mount({ url: 'https://cdn/a.zip', fileName: 'a.zip' });

      teardown();

      expect(stageOf(wrapper)).toBeNull();
      expect(wrapper.hasAttribute('data-file-object')).toBe(false);
    });

    it('aborts a read still in flight, and a late answer shows nothing', async () => {
      const gate: { open: (response: Response) => void; signal: AbortSignal | null } = { open: () => undefined, signal: null };
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
        gate.open = resolve;
        gate.signal = init.signal ?? null;
      })));
      const { wrapper, teardown } = mount({ url: 'https://cdn/a.ts', fileName: 'a.ts' });
      await vi.waitFor(() => expect(gate.signal).not.toBeNull());

      teardown();
      expect(gate.signal?.aborted).toBe(true);

      gate.open(text('late\n'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stageOf(wrapper)).toBeNull();
    });

    it('clears a drop still playing', () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 404 })));
      const { wrapper, teardown } = mount({ url: 'https://cdn/a.zip', fileName: 'a.zip' });
      const download = wrapper.querySelector<HTMLElement>('.blok-file-download');
      download?.addEventListener('click', (event) => event.preventDefault());
      download?.click();

      teardown();

      expect(download?.hasAttribute('data-dropping')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    });

    it('stops reacting to the pointer', () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(0), { status: 404 })));
      const { wrapper, teardown } = mount({ url: 'https://cdn/a.zip', fileName: 'a.zip' });
      const stage = stageOf(wrapper);

      teardown();
      wrapper.dispatchEvent(new MouseEvent('pointerenter'));

      expect(stage?.hasAttribute('data-hot')).toBe(false);
    });
  });
});
