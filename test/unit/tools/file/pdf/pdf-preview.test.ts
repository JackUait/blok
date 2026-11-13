import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfPageLike } from '../../../../../src/tools/file/pdf/pdf-types';

const loader = vi.hoisted(() => ({
  loadPdfJs: vi.fn(),
  supportsPdfJs: vi.fn(() => true),
}));

vi.mock('../../../../../src/tools/file/pdf/pdf-loader', () => loader);

import { openFilePreview } from '../../../../../src/tools/file/preview-modal';

const RAW = 'blob:https://example.com/raw';
const WRAPPED = 'blob:https://example.com/wrapped';
const LABELS = {
  close: 'Close preview',
  loading: 'Loading…',
  pdfPassword: 'This PDF is protected. Enter its password.',
  pdfPasswordWrong: 'That password is wrong. Try again.',
  pdfOpen: 'Open',
  cancel: 'Cancel',
};

type PasswordCallback = (answer: string | Error) => void;

interface FakeTask {
  promise: Promise<unknown>;
  onPassword: ((answer: PasswordCallback, reason: number) => void) | null;
  onProgress: ((progress: { loaded: number; total: number }) => void) | null;
  destroyed: number;
  destroy(): Promise<void>;
  resolve(doc: unknown): void;
  reject(error: unknown): void;
}

/** A loading task that settles when the test says so, and rejects on destroy() like pdf.js. */
function fakeTask(): FakeTask {
  const settle: { resolve: (doc: unknown) => void; reject: (error: unknown) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<unknown>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  const task: FakeTask = {
    promise,
    onPassword: null,
    onProgress: null,
    destroyed: 0,
    // Not a vi.fn: a spy watches the promise it returns, which hides an unhandled rejection.
    destroy: () => {
      task.destroyed += 1;
      settle.reject(new Error('Loading aborted'));

      // pdf.js destroy() is async and may itself reject.
      return Promise.reject(new Error('Worker was destroyed'));
    },
    resolve: (doc) => settle.resolve(doc),
    reject: (error) => settle.reject(error),
  };

  return task;
}

function fakePage(renderResult: () => Promise<void> = () => Promise.resolve()): PdfPageLike {
  return {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale, scale }),
    render: () => ({ promise: renderResult(), cancel: () => undefined }),
    getTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: () => Promise.resolve([]),
    cleanup: () => undefined,
  };
}

function fakeDoc(page: PdfPageLike = fakePage()): { numPages: number; getPage: () => Promise<PdfPageLike> } {
  return { numPages: 3, getPage: () => Promise.resolve(page) };
}

/** Reports every observed page as on screen at once. */
class ShowAllObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback([{ target, isIntersecting: true }] as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }

  unobserve(): void {}

  disconnect(): void {}
}

/** Never reports anything: no page draws. */
class QuietObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const body = (): HTMLElement => {
  const found = document.body.querySelector<HTMLElement>('.blok-file-preview-body');
  if (found === null) {
    throw new Error('no body');
  }

  return found;
};

describe('blob PDFs open with pdf.js', () => {
  let task: FakeTask;
  let getDocument: ReturnType<typeof vi.fn>;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    task = fakeTask();
    getDocument = vi.fn(() => task);
    loader.supportsPdfJs.mockReturnValue(true);
    loader.loadPdfJs.mockResolvedValue({ getDocument, TextLayer: undefined });
    vi.stubGlobal('IntersectionObserver', QuietObserver);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF-1.7'], { type: 'text/html' }) }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(WRAPPED);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      return { canvas: this } as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('shows the pages in a Blok view, not a frame', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    task.resolve(fakeDoc());
    await flush();

    expect(document.body.querySelector('[data-role="file-preview-pdf"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-role="file-preview-pdf-page"]')).toHaveLength(3);
    expect(document.body.querySelector('iframe')).toBeNull();
    expect(document.body.querySelector('[data-role="file-preview-loading"]')).toBeNull();
  });

  it('hands pdf.js the bytes with system fonts, no wasm and a canvas cap', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    const params = getDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(params.data as Uint8Array)).toBe('%PDF-1.7');
    expect(params.useSystemFonts).toBe(true);
    expect(params.useWasm).toBe(false);
    expect(params.canvasMaxAreaInBytes).toBe(16_777_216 * 4);
  });

  it('keeps the Download and Open in new tab links on the re-typed bytes', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    const created = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
    expect(created instanceof Blob && created.type).toBe('application/pdf');
    expect(document.body.querySelector('[data-action="preview-save"]')?.getAttribute('href')).toBe(WRAPPED);
    expect(document.body.querySelector('[data-action="preview-open-tab"]')?.getAttribute('href')).toBe(WRAPPED);
    expect(document.body.querySelector(`[href="${RAW}"]`)).toBeNull();
  });

  it('labels each page in the given language', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: { ...LABELS, pdfPageN: 'Seite {number}' } });
    await flush();
    task.resolve(fakeDoc());
    await flush();

    expect(document.body.querySelectorAll('[data-role="file-preview-pdf-page"]')[2]?.getAttribute('aria-label')).toBe('Seite 3');
  });

  it('shows how much has loaded when the size is known', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    task.onProgress?.({ loaded: 42, total: 100 });

    expect(body().querySelector('[data-role="file-preview-loading"]')?.textContent).toBe('Loading… 42%');
  });

  it('keeps the pages when progress arrives after they show', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    task.resolve(fakeDoc());
    await flush();

    task.onProgress?.({ loaded: 50, total: 100 });

    expect(body().querySelector('[data-role="file-preview-pdf"]')).not.toBeNull();
    expect(body().querySelector('[data-role="file-preview-loading"]')).toBeNull();
  });

  it('keeps the password prompt when progress arrives under it', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    task.onPassword?.(vi.fn<PasswordCallback>(), 1);

    task.onProgress?.({ loaded: 50, total: 100 });

    expect(body().querySelector('[data-role="file-preview-pdf-password"]')).not.toBeNull();
  });

  it('asks for the password and passes it on', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    const answer = vi.fn<PasswordCallback>();

    task.onPassword?.(answer, 1);

    const form = body().querySelector<HTMLFormElement>('[data-role="file-preview-pdf-password"]');
    expect(form?.textContent).toContain(LABELS.pdfPassword);
    expect(form?.textContent).not.toContain(LABELS.pdfPasswordWrong);
    const input = form?.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input?.getAttribute('aria-label')).toBe(LABELS.pdfPassword);
    expect(input).toHaveFocus();
    if (input === null || input === undefined || form === null || form === undefined) {
      throw new Error('no form');
    }
    input.value = 'blok';
    form.querySelector<HTMLButtonElement>('[data-action="preview-pdf-password-open"]')?.click();

    expect(answer).toHaveBeenCalledWith('blok');
    expect(body().querySelector('[data-role="file-preview-pdf-password"]')).toBeNull();
    expect(body().querySelector('[data-role="file-preview-loading"]')).not.toBeNull();
  });

  it('says so when the password was wrong', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    task.onPassword?.(vi.fn<PasswordCallback>(), 2);

    expect(body().querySelector('[data-role="file-preview-pdf-password-wrong"]')?.textContent).toBe(LABELS.pdfPasswordWrong);
  });

  it('shows the error card, not a spinner, when the password prompt is cancelled', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    // pdf.js rejects the loading task when the answer is an Error.
    const answer = vi.fn<PasswordCallback>((value) => {
      if (value instanceof Error) {
        task.reject(Object.assign(new Error('No password given'), { name: 'PasswordException' }));
      }
    });
    task.onPassword?.(answer, 1);

    body().querySelector<HTMLButtonElement>('[data-action="preview-pdf-password-cancel"]')?.click();
    await flush();

    expect(answer.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(body().querySelector('[data-role="file-preview-error"]')).not.toBeNull();
    expect(body().querySelector('[data-role="file-preview-loading"]')).toBeNull();
    expect(body().querySelector('[data-role="file-preview-pdf-password"]')).toBeNull();
  });

  it('shows the error card for a file pdf.js cannot read', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    task.reject(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }));
    await flush();

    expect(body().querySelector('[data-role="file-preview-error"]')).not.toBeNull();
    expect(document.body.querySelector('iframe')).toBeNull();
  });

  it('shows the error card when pdf.js itself fails to load', async () => {
    loader.loadPdfJs.mockRejectedValue(new Error('chunk failed'));
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    expect(body().querySelector('[data-role="file-preview-error"]')).not.toBeNull();
  });

  it('shows the error card when a page fails to draw', async () => {
    vi.stubGlobal('IntersectionObserver', ShowAllObserver);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    task.resolve(fakeDoc(fakePage(() => Promise.reject(new Error('bad page')))));
    await flush();

    expect(body().querySelector('[data-role="file-preview-error"]')).not.toBeNull();
    expect(body().querySelector('[data-role="file-preview-pdf"]')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('destroys the loading task when closed mid-load, with no unhandled rejection', async () => {
    const teardown = openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    const closedBody = body();

    teardown();
    await flush();

    expect(task.destroyed).toBe(1);
    expect(unhandled).toEqual([]);
    expect(closedBody.querySelector('[data-role="file-preview-error"]')).toBeNull();
  });

  it('never opens pdf.js when closed before it loads', async () => {
    const pending: { resolve: (lib: unknown) => void } = { resolve: () => undefined };
    loader.loadPdfJs.mockReturnValue(new Promise((resolve) => { pending.resolve = resolve; }));
    const teardown = openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    teardown();
    pending.resolve({ getDocument, TextLayer: undefined });
    await flush();

    expect(getDocument).not.toHaveBeenCalled();
  });

  it('frees the view and the task on close', async () => {
    const teardown = openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    task.resolve(fakeDoc());
    await flush();

    teardown();
    await flush();

    expect(task.destroyed).toBe(1);
    expect(unhandled).toEqual([]);
  });

  it('runs the scroll haze over the pdf view', async () => {
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();
    task.resolve(fakeDoc());
    await flush();

    expect(body().querySelectorAll('[data-blok-haze]')).toHaveLength(4);
  });

  it('fills each drawn page with pdf.js text', async () => {
    vi.stubGlobal('IntersectionObserver', ShowAllObserver);
    const made: Array<{ container: HTMLElement; textContentSource: unknown; rendered: boolean }> = [];
    class FakeTextLayer {
      readonly made: { container: HTMLElement; textContentSource: unknown; rendered: boolean };

      constructor({ container, textContentSource }: { container: HTMLElement; textContentSource: unknown }) {
        this.made = { container, textContentSource, rendered: false };
        made.push(this.made);
      }

      render(): Promise<void> {
        this.made.rendered = true;

        return Promise.resolve();
      }

      cancel(): void {}
    }
    loader.loadPdfJs.mockResolvedValue({ getDocument, TextLayer: FakeTextLayer });
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    task.resolve(fakeDoc());
    await flush();

    expect(made).toHaveLength(3);
    expect(made.every((layer) => layer.rendered)).toBe(true);
    expect(made[0].textContentSource).toEqual({ items: [] });
    const page = body().querySelectorAll('[data-role="file-preview-pdf-page"]')[0];
    expect(page.querySelector('.blok-file-preview-pdf-text')).toBe(made[0].container);
  });

  it('keeps the browser frame where pdf.js cannot run', async () => {
    loader.supportsPdfJs.mockReturnValue(false);
    openFilePreview({ url: RAW, fileName: 'a.pdf', labels: LABELS });
    await flush();

    expect(document.body.querySelector('[data-role="file-preview-frame"]')?.getAttribute('src')).toBe(WRAPPED);
    expect(loader.loadPdfJs).not.toHaveBeenCalled();
  });
});
