import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGES_STORAGE_KEY,
  PageRegistry,
  PointerWatch,
  keepPageHeaderAligned,
  pointerBlock,
  renderPageHeader,
  pageIdFromPath,
  pagePath,
  type PageMap,
} from '../../../src/playground/page-host';

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [{ id: 'g1', type: 'paragraph', data: { text: 'Hi' } }] },
  keys: { title: 'Keys', parentId: 'guide', blocks: [] },
});

describe('page routes', () => {
  it('reads the page id from an /editor/page/<id> path', () => {
    expect(pageIdFromPath('/editor/page/abc-1')).toBe('abc-1');
    expect(pageIdFromPath('/editor/page/abc-1/')).toBe('abc-1');
  });

  it('treats anything else as the root document', () => {
    expect(pageIdFromPath('/editor')).toBeNull();
    expect(pageIdFromPath('/editor/page/')).toBeNull();
    expect(pageIdFromPath('/icons/page/abc')).toBeNull();
  });

  it('treats a malformed escape in the id as the root document instead of throwing', () => {
    expect(pageIdFromPath('/editor/page/%E0')).toBeNull();
    expect(pageIdFromPath('/editor/page/%')).toBeNull();
  });

  it('decodes an encoded id and keeps the query on the built path', () => {
    expect(pageIdFromPath('/editor/page/a%20b')).toBe('a b');
    expect(pagePath('a b', '?collab=off')).toBe('/editor/page/a%20b?collab=off');
    expect(pagePath(null, '?collab=off')).toBe('/editor?collab=off');
  });
});

describe('PageRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('starts from the seed and resolves a page to its title and emoji icon', () => {
    const pages = new PageRegistry(seed());

    expect(pages.info('guide')).toEqual({ title: 'Guide', icon: { type: 'emoji', value: '📘' }, path: ['Playground'] });
    expect(pages.info('keys')).toEqual({ title: 'Keys', path: ['Playground', 'Guide'] });
    expect(pages.info('nope')).toBeNull();
  });

  it('keeps edits in localStorage, so a new registry sees them', () => {
    const first = new PageRegistry(seed());

    first.setTitle('guide', 'Handbook');
    first.setIcon('guide', undefined);
    first.create('fresh', 'guide');
    first.setBlocks('fresh', [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }]);

    const second = new PageRegistry(seed());

    expect(second.info('guide')).toEqual({ title: 'Handbook', path: ['Playground'] });
    expect(second.get('fresh')).toEqual({
      title: '',
      parentId: 'guide',
      blocks: [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }],
    });
    expect(JSON.parse(localStorage.getItem(PAGES_STORAGE_KEY) ?? '{}')).toHaveProperty('fresh');
  });

  it('builds the breadcrumb trail from the root down, ending at the page', () => {
    const pages = new PageRegistry(seed());

    expect(pages.trail('keys').map((crumb) => crumb.id)).toEqual(['guide', 'keys']);
    expect(pages.trail('guide').map((crumb) => crumb.id)).toEqual(['guide']);
  });

  it('stops the trail at a parent cycle instead of looping forever', () => {
    const pages = new PageRegistry({
      a: { title: 'A', parentId: 'b', blocks: [] },
      b: { title: 'B', parentId: 'a', blocks: [] },
    });

    expect(pages.trail('a').map((crumb) => crumb.id)).toEqual(['b', 'a']);
  });

  it('a new page does not overwrite an existing one', () => {
    const pages = new PageRegistry(seed());

    pages.create('guide', null);

    expect(pages.get('guide')?.title).toBe('Guide');
  });

  it('reset drops every edit and goes back to the seed', () => {
    const pages = new PageRegistry(seed());

    pages.create('fresh', null);
    pages.setTitle('guide', 'Changed');
    pages.reset();

    expect(pages.get('fresh')).toBeUndefined();
    expect(pages.get('guide')?.title).toBe('Guide');
    expect(new PageRegistry(seed()).get('fresh')).toBeUndefined();
  });

  it('falls back to the seed when storage holds something that is not a page map', () => {
    localStorage.setItem(PAGES_STORAGE_KEY, '[1,2,3]');

    expect(new PageRegistry(seed()).get('guide')?.title).toBe('Guide');
  });
});

describe('root page header', () => {
  const headerOptions = (pages: PageRegistry, pageId: string | null): Parameters<typeof renderPageHeader>[1] => ({
    pageId,
    pages,
    search: '',
    readOnly: false,
    navigate: vi.fn(),
    focusEditor: vi.fn(),
    i18n: vi.fn(),
    changed: vi.fn(),
    restore: vi.fn(),
    purge: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('the root document shows a title and an icon button, like a page', () => {
    const host = document.createElement('header');

    renderPageHeader(host, headerOptions(new PageRegistry(seed()), null));

    expect(host.hidden).toBe(false);
    expect(host.querySelector('h1')?.textContent).toBe('Playground');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Add icon');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect([...host.querySelectorAll('.pg-crumb-text')].map((el) => el.textContent)).toEqual(['Playground']);
  });

  it('a root title typed in the header is saved and renames the breadcrumb', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const options = headerOptions(pages, null);

    renderPageHeader(host, options);

    const title = host.querySelector('h1');

    if (title === null) throw new Error('no title');
    title.textContent = 'Workspace';
    title.dispatchEvent(new Event('input'));

    expect(pages.root().title).toBe('Workspace');
    expect(host.querySelector('.pg-crumb-text')?.textContent).toBe('Workspace');
    expect(options.changed).toHaveBeenCalled();
  });

  it('keeps the root title and icon in localStorage, and reset brings back the default', () => {
    const first = new PageRegistry(seed());

    first.setTitle(null, 'Workspace');
    first.setIcon(null, '🏠');

    const second = new PageRegistry(seed());

    expect(second.root()).toEqual({ title: 'Workspace', icon: '🏠' });
    second.reset();
    expect(second.root()).toEqual({ title: 'Playground' });
    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Playground' });
  });

  it('a renamed root shows up in page paths and in a sub-page breadcrumb', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');

    pages.setTitle(null, 'Workspace');
    pages.setIcon(null, '🏠');
    renderPageHeader(host, headerOptions(pages, 'keys'));

    expect(pages.info('keys')?.path).toEqual(['Workspace', 'Guide']);
    expect(host.querySelector('.pg-crumb')?.textContent).toBe('🏠Workspace');
  });

  it('an empty root title reads Untitled in paths', () => {
    const pages = new PageRegistry(seed());

    pages.setTitle(null, '');

    expect(pages.info('guide')?.path).toEqual(['Untitled']);
  });
});

describe('page trash', () => {
  const pointer = (pageId: string): { id: string; type: string; data: { pageId: string } } =>
    ({ id: `p-${pageId}`, type: 'page', data: { pageId } });
  const para = { id: 'x', type: 'paragraph', data: { text: 'Hi' } };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('trashes a page once its block is seen and then removed from the parent', () => {
    const pages = new PageRegistry(seed());
    const watch = new PointerWatch(pages);

    watch.observe([para, pointer('keys')]);
    expect(pages.trashedIn('keys')).toBeNull();

    watch.observe([para]);
    expect(pages.trashedIn('keys')?.id).toBe('keys');
    expect(new PageRegistry(seed()).trashedIn('keys')?.id).toBe('keys');
  });

  it('never trashes a page whose block was missing from the start', () => {
    const pages = new PageRegistry(seed());
    const watch = new PointerWatch(pages);

    watch.observe([para]);
    watch.observe([para]);

    expect(pages.trashedIn('keys')).toBeNull();
  });

  it('takes the page out of trash when its block comes back, as undo does', () => {
    const pages = new PageRegistry(seed());
    const watch = new PointerWatch(pages);

    watch.observe([pointer('keys')]);
    watch.observe([]);
    watch.observe([pointer('keys')]);

    expect(pages.trashedIn('keys')).toBeNull();
  });

  it('untrashes a page whose block a fresh editor finds in its parent', () => {
    const pages = new PageRegistry(seed());

    pages.trash('keys');
    new PointerWatch(pages).observe([pointer('keys')]);

    expect(pages.trashedIn('keys')).toBeNull();
  });

  it('puts a sub-page in trash with the page that holds it', () => {
    const pages = new PageRegistry(seed());

    pages.trash('guide');

    expect(pages.trashedIn('keys')?.id).toBe('guide');
  });

  it('restore takes the page out of trash and asks its parent for a block back', () => {
    const pages = new PageRegistry(seed());

    pages.trash('keys');
    pages.restore('keys');

    expect(pages.trashedIn('keys')).toBeNull();
    expect(pages.pendingRestores('guide')).toEqual(['keys']);
    expect(pages.pendingRestores(null)).toEqual([]);

    pages.restored('keys');
    expect(pages.pendingRestores('guide')).toEqual([]);
  });

  it('builds the restored block with the page title and icon', () => {
    const pages = new PageRegistry(seed());
    const block = pointerBlock('guide', pages);

    expect(block.type).toBe('page');
    expect(block.data).toEqual({ pageId: 'guide', cache: { title: 'Guide', icon: { type: 'emoji', value: '📘' } } });
  });

  it('permanent delete drops the page and its sub-pages and names where to go', () => {
    const pages = new PageRegistry(seed());

    pages.trash('guide');

    expect(pages.purge('guide')).toBeNull();
    expect(pages.has('guide')).toBe(false);
    expect(pages.has('keys')).toBe(false);
    expect(new PageRegistry(seed()).has('keys')).toBe(false);
  });

  it('reset clears trash', () => {
    const pages = new PageRegistry(seed());

    pages.trash('guide');
    pages.reset();

    expect(pages.trashedIn('guide')).toBeNull();
  });

  it('the header of a trashed page offers restore and permanent delete', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const restore = vi.fn();
    const purge = vi.fn();

    pages.trash('guide');
    document.body.append(host);
    renderPageHeader(host, {
      pageId: 'keys',
      pages,
      search: '',
      readOnly: false,
      navigate: vi.fn(),
      focusEditor: vi.fn(),
      i18n: vi.fn(),
      changed: vi.fn(),
      restore,
      purge,
    });

    const banner = host.querySelector('[role="status"]');

    expect(banner?.textContent).toContain('Guide');
    host.querySelectorAll('button').forEach((button) => {
      if (button.textContent === 'Restore page') button.click();
      if (button.textContent === 'Permanently delete') button.click();
    });
    expect(restore).toHaveBeenCalledWith('guide');
    expect(purge).toHaveBeenCalledWith('guide');
  });

  it('every rounded header control carries the radius tokens, but the title does not get the editor resets', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');

    pages.trash('keys');
    renderPageHeader(host, {
      pageId: 'keys',
      pages,
      search: '',
      readOnly: false,
      navigate: vi.fn(),
      focusEditor: vi.fn(),
      i18n: vi.fn(),
      changed: vi.fn(),
      restore: vi.fn(),
      purge: vi.fn(),
    });

    const rounded = [
      ...host.querySelectorAll('.pg-crumb'),
      ...host.querySelectorAll('button'),
      host.querySelector('.pg-trash-banner'),
    ];

    expect(rounded.length).toBeGreaterThan(4);
    rounded.forEach((el) => expect(el?.closest('[data-blok-interface]')).not.toBeNull());
    expect(host.querySelector('h1')?.closest('[data-blok-interface]')).toBeNull();
  });

  it('a page that is not in trash has no banner', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');

    renderPageHeader(host, {
      pageId: 'keys',
      pages,
      search: '',
      readOnly: false,
      navigate: vi.fn(),
      focusEditor: vi.fn(),
      i18n: vi.fn(),
      changed: vi.fn(),
      restore: vi.fn(),
      purge: vi.fn(),
    });

    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});

describe('playground collaboration room per page', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('const DEV_SERVER_URL =');
  const source = html.slice(from, html.indexOf('function buildConfig(', from));

  const roomFor = (search: string, call: string): unknown =>
    structuredClone(runInNewContext(`${source} ${call};`, {
      window: { location: { search } },
      URLSearchParams,
      __BLOK_DEV_BACKEND__: true,
    }));

  it('gives each page its own document, next to the shared one', () => {
    expect(roomFor('', "collaborationConfig('abc')")).toEqual({ doc: 'playground--page--abc' });
    expect(roomFor('?collab=room', "collaborationConfig('abc')")).toEqual({ doc: 'room--page--abc' });
  });

  it('keeps the root document and the off switch as they were', () => {
    expect(roomFor('', 'collaborationConfig()')).toEqual({ doc: 'playground' });
    expect(roomFor('?collab=off', "collaborationConfig('abc')")).toBeNull();
  });
});

describe('playground saves a pending page edit when the tab goes away', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('let persistTimer;');
  const source = html.slice(from, html.indexOf('function renderHeader()', from));

  type Listener = () => void;
  const livePages = [{ type: 'page', data: { pageId: 'keys' } }];

  const boot = (options: { save?: () => Promise<{ blocks: unknown[] }>; collab?: boolean } = {}) => {
    const windowListeners = new Map<string, Listener>();
    const documentListeners = new Map<string, Listener>();
    const stored: unknown[] = [];
    const timers = new Map<number, () => void>();
    const save = vi.fn(options.save ?? (() => Promise.resolve({ blocks: [{ id: 'live' }] })));
    const context = {
      blok: { save },
      livePointers: null as unknown,
      syncPointers: (_api: unknown, _pageId: unknown, pointers: { observe(blocks: unknown[]): void } | null | undefined) => pointers?.observe(livePages),
      editorPageId: 'guide',
      collaborationConfig: () => (options.collab === true ? { doc: 'x' } : null),
      storeBlocks: (_pageId: string | null, blocks: unknown[]) => stored.push(blocks),
      setTimeout: (fn: () => void) => {
        const id = timers.size + 1;

        timers.set(id, fn);

        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
      console: { error: vi.fn() },
      window: { addEventListener: (type: string, fn: Listener) => windowListeners.set(type, fn) },
      document: {
        visibilityState: 'visible',
        addEventListener: (type: string, fn: Listener) => documentListeners.set(type, fn),
      },
    };

    runInNewContext(`${source}; this.schedulePersist = schedulePersist;`, context);

    const schedule = (context as unknown as { schedulePersist: (api: unknown, pageId: string, options?: unknown) => void }).schedulePersist;

    return { context, save, stored, timers, windowListeners, documentListeners, schedule };
  };

  const settle = (): Promise<void> => new Promise((done) => {
    setImmediate(done);
  });

  it('flushes the debounced save on pagehide, so the last edit survives a reload', async () => {
    const page = boot();

    page.schedule({ saver: { save: page.save } }, 'guide');
    page.windowListeners.get('pagehide')?.();
    await settle();

    expect(page.stored).toEqual([[{ id: 'live' }]]);
    expect(page.timers.size).toBe(0);
  });

  it('flushes when the tab is hidden, but not when it becomes visible', async () => {
    const page = boot();

    page.schedule({ saver: { save: page.save } }, 'guide');
    page.documentListeners.get('visibilitychange')?.();
    await settle();
    expect(page.stored).toEqual([]);

    page.context.document.visibilityState = 'hidden';
    page.documentListeners.get('visibilitychange')?.();
    await settle();
    expect(page.stored).toEqual([[{ id: 'live' }]]);
  });

  it('checks page blocks after each change, and keeps a copy of the page, collab included, for the hover preview', async () => {
    const local = boot();
    const localWatch = { observe: vi.fn() };

    local.schedule({ saver: { save: local.save } }, 'guide', { pointers: localWatch });
    [...local.timers.values()][0]();
    await settle();
    expect(local.stored).toEqual([[{ id: 'live' }]]);
    expect(localWatch.observe).toHaveBeenCalledWith(livePages);

    const shared = boot({ collab: true });
    const sharedWatch = { observe: vi.fn() };

    shared.schedule({ saver: { save: shared.save } }, 'guide', { pointers: sharedWatch });
    [...shared.timers.values()][0]();
    await settle();
    expect(shared.stored).toEqual([[{ id: 'live' }]]);
    expect(sharedWatch.observe).toHaveBeenCalledWith(livePages);
  });

  it('checks page blocks even when saving the document fails', async () => {
    const page = boot({ save: () => Promise.reject(new Error('Saver: table children diverge')) });
    const watch = { observe: vi.fn() };

    page.schedule({ saver: { save: page.save } }, 'guide', { pointers: watch });
    [...page.timers.values()][0]();
    await settle();

    expect(watch.observe).toHaveBeenCalledWith(livePages);
  });

  it('checks page blocks when leaving a collaborative page before the debounce ran', async () => {
    const page = boot({ collab: true });
    const watch = { observe: vi.fn() };

    page.context.livePointers = watch;
    page.schedule({ saver: { save: page.save } }, 'guide', { pointers: watch });
    page.windowListeners.get('pagehide')?.();
    await settle();

    expect(page.stored).toEqual([[{ id: 'live' }]]);
    expect(watch.observe).toHaveBeenCalledWith(livePages);
  });

  it('does nothing when no save is pending', async () => {
    const page = boot();

    page.windowListeners.get('pagehide')?.();
    await settle();

    expect(page.save).not.toHaveBeenCalled();
    expect(page.stored).toEqual([]);
  });

  it('does not throw when the editor is gone mid-destroy', async () => {
    const page = boot({
      save: () => {
        throw new Error('destroyed');
      },
    });

    page.schedule({ saver: { save: page.save } }, 'guide');

    expect(() => page.windowListeners.get('pagehide')?.()).not.toThrow();
    await settle();
    expect(page.stored).toEqual([]);
  });
});

describe('keepPageHeaderAligned', () => {
  const rect = (left: number, width: number): DOMRect => ({ left, width } as DOMRect);
  let resize: () => void = () => undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resize = callback;
      }

      observe(): void {}

      disconnect(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lines the header up with the text once a late document renders', () => {
    const column = document.createElement('div');
    const header = document.createElement('header');
    const holder = document.createElement('div');

    column.append(header, holder);
    document.body.append(column);
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(rect(100, 1000));

    keepPageHeaderAligned(header, holder);

    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(268, 720));
    holder.append(content);
    resize();

    expect(header.style.marginLeft).toBe('168px');
    expect(header.style.maxWidth).toBe('720px');
  });
});
