import { vi, type Mock } from 'vitest';
import type { PdfViewLib } from '../../../../../src/tools/file/pdf/pdf-view';
import type { PdfDocumentLike, PdfPageLike, PdfViewport } from '../../../../../src/tools/file/pdf/pdf-types';
import { detachedChrome, type PreviewChrome } from '../../../../../src/tools/file/preview-chrome';

export const PX_PER_PT = 96 / 72;

export interface RenderCall {
  page: number;
  viewport: PdfViewport;
  canvas: HTMLCanvasElement;
  cancel: Mock<() => void>;
  /** Settles the render when the doc holds renders. */
  finish: () => void;
}

export interface TextDoc extends PdfDocumentLike {
  renders: RenderCall[];
  cleaned: number[];
  /** Pages whose text was read, in call order (1-based). */
  textReads: number[];
  /** Renders stay pending until finished or cancelled when true. */
  hold: boolean;
}

/** One text item per string; pdf.js puts a line end after each. */
export const textContentOf = (lines: string[]): { items: Array<{ str: string; hasEOL: boolean }> } =>
  ({ items: lines.map((str) => ({ str, hasEOL: true })) });

/** A doc of `count` pages, Letter unless `sizes` says otherwise (pt). `text(n)` is page n's lines. */
export function textDoc(
  count: number,
  text: (n: number) => string[] = (n) => [`Blok PDF page ${n}`],
  sizes: Record<number, [number, number]> = {},
): TextDoc {
  const doc: TextDoc = {
    numPages: count,
    renders: [],
    cleaned: [],
    textReads: [],
    hold: false,
    getPage: (n) => {
      const [w, h] = sizes[n] ?? [612, 792];
      const page: PdfPageLike = {
        getViewport: ({ scale }) => ({ width: w * scale, height: h * scale, scale }),
        render: ({ canvasContext, viewport }) => {
          const done: { resolve: () => void; reject: (error: Error) => void } = { resolve: () => undefined, reject: () => undefined };
          const promise = doc.hold
            ? new Promise<void>((resolve, reject) => Object.assign(done, { resolve, reject }))
            : Promise.resolve();
          const cancel = vi.fn<() => void>(() => done.reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })));
          doc.renders.push({ page: n, viewport, canvas: canvasContext.canvas, cancel, finish: () => done.resolve() });

          return { promise, cancel };
        },
        getTextContent: () => {
          doc.textReads.push(n);

          return Promise.resolve(textContentOf(text(n)));
        },
        getAnnotations: () => Promise.resolve([]),
        cleanup: () => doc.cleaned.push(n),
      };

      return Promise.resolve(page);
    },
  };

  return doc;
}

/** A text layer shaped like pdf.js's: one presentation span per item with text, a <br> per line end. */
export const textLayerLib: PdfViewLib = {
  renderTextLayer: async (page, _viewport, host) => {
    const content = await page.getTextContent() as ReturnType<typeof textContentOf>;
    content.items.forEach((item) => {
      if (item.str !== '') {
        const span = document.createElement('span');
        span.setAttribute('role', 'presentation');
        span.textContent = item.str;
        host.appendChild(span);
      }
      if (item.hasEOL) {
        host.appendChild(document.createElement('br'));
      }
    });

    return { cancel: () => undefined };
  },
};

/** A stand-in IntersectionObserver the test drives. Every instance is kept. */
export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets: Element[] = [];
  readonly disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit = {}) {
    FakeObserver.all.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    this.targets.splice(this.targets.indexOf(target), 1);
  }

  /** Report targets `from`..`to` (1-based) on screen and every other one off it. */
  show(from: number, to: number): void {
    const entries = this.targets.map((target, i) => ({ target, isIntersecting: i + 1 >= from && i + 1 <= to }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

/** The observer watching the page boxes: the first one made. */
export const pageObserver = (): FakeObserver => {
  const found = FakeObserver.all[0];
  if (found === undefined) {
    throw new Error('no observer');
  }

  return found;
};

export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface Harness {
  container: HTMLElement;
  chrome: PreviewChrome;
  releases: Array<() => void>;
  release: () => void;
  scroller: () => HTMLElement;
  pages: () => HTMLElement[];
}

const made: Harness[] = [];

/** Closes every preview a test opened. Find paint is page-global, so a test that leaves one open leaks it. */
export const releaseAll = (): void => made.splice(0).forEach((h) => h.release());

/** A chrome whose keys come from keydowns in the container, as the modal's do. */
export function harness(): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const releases: Array<() => void> = [];
  const keys: Array<(event: KeyboardEvent) => void> = [];
  container.addEventListener('keydown', (event) => keys.forEach((handler) => handler(event)));
  const chrome: PreviewChrome = {
    ...detachedChrome(container, () => false, (release) => releases.push(release)),
    onKey: (handler) => keys.push(handler),
  };
  const scroller = (): HTMLElement => {
    const found = container.querySelector<HTMLElement>('[data-role="file-preview-pdf"]');
    if (found === null) {
      throw new Error('no scroller');
    }

    return found;
  };

  const h: Harness = {
    container, chrome, releases, scroller,
    release: () => releases.splice(0).forEach((release) => release()),
    pages: () => Array.from(container.querySelectorAll<HTMLElement>('[data-role="file-preview-pdf-page"]')),
  };
  made.push(h);

  return h;
}

export const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);

  return event;
};

/** requestIdleCallback the test runs by hand. `budget` is how many timeRemaining() reads return time left. */
export function manualIdle(): { run(count?: number): void; runAll(): Promise<void>; pending(): number; budget: number } {
  const queue: IdleRequestCallback[] = [];
  const idle = {
    budget: 0,
    pending: () => queue.length,
    run: (count = 1) => {
      queue.splice(0, count).forEach((callback) => {
        const left = { reads: idle.budget };
        callback({ didTimeout: false, timeRemaining: () => (left.reads-- > 0 ? 10 : 0) });
      });
    },
    runAll: async () => {
      for (let i = 0; i < 10_000 && queue.length > 0; i++) {
        idle.run(queue.length);
        await settle();
      }
    },
  };
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => queue.push(callback));
  vi.stubGlobal('cancelIdleCallback', () => undefined);

  return idle;
}

/** CSS.highlights stand-in, so the paint can be read back. */
export class FakeHighlight extends Set<Range> {
  priority = 0;

  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

export const highlights = new Map<string, FakeHighlight>();

export const painted = (name: string): string[] => [...highlights.get(name) ?? []].map((range) => range.toString());
