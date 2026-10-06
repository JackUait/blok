import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Paragraph } from '../../src/tools/paragraph';
import type { OutputData } from '../../types';

const SKELETON = '[data-blok-loading-skeleton]';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void }

/** Records whether a skeleton was EVER mounted, so a fast path cannot hide a flash. */
const watchForSkeleton = (root: HTMLElement): { seen: () => boolean; stop: () => void } => {
  let seen = false;
  const observer = new MutationObserver((records) => {
    seen ||= records.some(record => [...record.addedNodes].some(node => node instanceof Element && (node.matches(SKELETON) || node.querySelector(SKELETON) !== null)));
  });

  observer.observe(root, { childList: true, subtree: true });

  return { seen: () => seen, stop: () => observer.disconnect() };
};

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('boot skeleton (persistence)', () => {
  let holder: HTMLDivElement;
  const editors: TestEditor[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const boot = async (config: Record<string, unknown>, target: HTMLElement = holder): Promise<TestEditor> => {
    const { Blok } = await import('../../src/blok');
    const editor = new Blok({ holder: target, tools: { paragraph: Paragraph }, ...config }) as unknown as TestEditor;

    editors.push(editor);

    return editor;
  };

  const wrapperOf = (root: HTMLElement): Element | null => root.querySelector('[data-blok-editor]');

  it('shows the skeleton while load() is slow; isReady waits for the handoff', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    expect(wrapperOf(holder)?.getAttribute('aria-busy')).toBe('true');
    // The shared live region sits on body, outside the busy wrapper.
    await vi.waitFor(() => expect(document.querySelector('[data-blok-announcer][role="status"]')?.textContent).toBe('Loading content…'));
    expect(wrapperOf(holder)?.querySelector('[role="status"]')).toBeNull();

    load.resolve({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] });
    await editor.isReady;

    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
    expect(holder.textContent).toContain('Hi');
  }, 120_000);

  it('keeps the redactor inert while the skeleton is up, and editable after isReady', async () => {
    const load = deferred<OutputData>();
    const onChange = vi.fn();
    const editor = await boot({ loader: { delay: 0 }, onChange, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    load.resolve({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] });

    // Blocks are rendered but the handoff still runs: onChange is not wired yet, so an edit here would be lost.
    await vi.waitFor(() => expect(holder.querySelector('[data-blok-element]')).not.toBeNull());
    expect(holder.querySelector(SKELETON)).not.toBeNull();
    expect(holder.querySelector('[data-blok-redactor]')?.hasAttribute('inert')).toBe(true);

    await editor.isReady;
    expect(holder.querySelector('[data-blok-redactor]')?.hasAttribute('inert')).toBe(false);

    // jsdom does not reflect contentEditable to the attribute, so reach the paragraph by structure.
    const editable = holder.querySelector('[data-blok-element-content]')?.firstElementChild ?? null;

    expect(editable).not.toBeNull();
    if (editable !== null) {
      editable.textContent = 'Hi there';
    }
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
  }, 120_000);

  // The redactor is inert, but the bottom zone is a wrapper child with its own append-a-block click.
  it.each(['while load() is pending', 'during the handoff'])('a bottom-zone click %s adds no block', async (phase) => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });
    const clickBottomZone = (): void => {
      holder.querySelector('[data-blok-bottom-zone]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    };

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    if (phase === 'while load() is pending') {
      clickBottomZone();
    }
    load.resolve({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] });
    if (phase === 'during the handoff') {
      await vi.waitFor(() => expect(holder.querySelector('[data-blok-element]')).not.toBeNull());
      expect(holder.querySelector(SKELETON)).not.toBeNull();
      clickBottomZone();
    }
    await editor.isReady;

    expect(holder.querySelectorAll('[data-blok-element]')).toHaveLength(1);
  }, 120_000);

  it('hands each skeleton bar to its block content box, never the full-width holder', async () => {
    const animate = vi.fn((): Animation => ({ finished: Promise.resolve(), cancel: () => {} }) as unknown as Animation);

    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });

    const measured: Element[] = [];
    const realRect = Element.prototype.getBoundingClientRect;

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      measured.push(this);

      return realRect.call(this);
    });

    try {
      const load = deferred<OutputData>();
      const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

      await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
      measured.length = 0;
      load.resolve({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] });
      await editor.isReady;

      const blockHolder = holder.querySelector('[data-blok-element]');
      const content = blockHolder?.querySelector(':scope > [data-blok-element-content]');

      expect(content).not.toBeNull();
      expect(measured).toContain(content);
      expect(measured).not.toContain(blockHolder);
      expect(animate).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, 'animate');
      Reflect.deleteProperty(Element.prototype, 'getAnimations');
    }
  }, 120_000);

  it('never mounts a skeleton when data is passed directly', async () => {
    const watch = watchForSkeleton(holder);
    const editor = await boot({ loader: { delay: 0 }, data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] } });

    await editor.isReady;
    watch.stop();

    expect(watch.seen()).toBe(false);
  }, 120_000);

  it('never mounts a skeleton with loader: false', async () => {
    const watch = watchForSkeleton(holder);
    const load = deferred<OutputData>();
    const editor = await boot({ loader: false, persistence: { load: () => load.promise, save: async () => {} } });

    await new Promise(resolve => setTimeout(resolve, 20));
    load.resolve({ blocks: [] });
    await editor.isReady;
    watch.stop();

    expect(watch.seen()).toBe(false);
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
  }, 120_000);

  it('load() resolving null hands off to the default block', async () => {
    const load = deferred<OutputData | null>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    load.resolve(null);
    await editor.isReady;

    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(holder.querySelectorAll('[data-blok-element]').length).toBe(1);
  }, 120_000);

  it('a rejected load removes the skeleton and isReady still rejects', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    load.reject(new Error('endpoint down'));

    await expect(editor.isReady).rejects.toThrow('endpoint down');
    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
  }, 120_000);

  it('marks only the loading editor busy when two share a page', async () => {
    const other = document.createElement('div');

    document.body.appendChild(other);
    const load = deferred<OutputData>();
    const loading = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });
    const ready = await boot({ data: { blocks: [] } }, other);

    await ready.isReady;
    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());

    expect(wrapperOf(other)?.hasAttribute('aria-busy')).toBe(false);
    expect(other.querySelector(SKELETON)).toBeNull();

    load.resolve({ blocks: [] });
    await loading.isReady;
  }, 120_000);

  // A destroy() before boot ends only takes effect once isReady settles, so the load must finish here.
  it('destroy() mid-load mounts no late skeleton and leaves an empty holder', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 50 }, persistence: { load: () => load.promise, save: async () => {} } });
    const ready = editor.isReady;

    await vi.waitFor(() => expect(wrapperOf(holder)).not.toBeNull());
    const watch = watchForSkeleton(holder);

    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(watch.seen()).toBe(false);
    expect(holder.querySelector(SKELETON)).toBeNull();

    load.resolve({ blocks: [] });
    await ready;
    watch.stop();

    expect(holder.childElementCount).toBe(0);
  }, 120_000);

  it('destroy() in the same tick as construction mounts no skeleton', async () => {
    const { Blok } = await import('../../src/blok');
    const load = deferred<OutputData>();
    const watch = watchForSkeleton(holder);
    const editor = new Blok({ holder, tools: { paragraph: Paragraph }, loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } }) as unknown as TestEditor;
    const ready = editor.isReady;

    editor.destroy();
    await vi.waitFor(() => expect(wrapperOf(holder)).not.toBeNull());
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(watch.seen()).toBe(false);

    load.resolve({ blocks: [] });
    await ready;
    watch.stop();

    expect(holder.childElementCount).toBe(0);
  }, 120_000);
});
