import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGES_STORAGE_KEY,
  ROOT_STORAGE_KEY,
  PageRegistry,
  PointerWatch,
  keepPageHeaderAligned,
  pointerBlock,
  renderPageHeader,
  pageIdFromPath,
  pagePath,
  type PageMap,
} from '../../../src/playground/page-host';
import { PLAYGROUND_ROOT_TITLE } from '../../../scripts/dev.mjs';

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

  // scripts/dev.mjs cannot import this .ts file, so it keeps its own copy of the root title.
  it('defaults the root title to the one the dev server seeds the root room with', () => {
    expect(new PageRegistry(seed()).root().title).toBe(PLAYGROUND_ROOT_TITLE);
  });

  it('starts from the seed and resolves a page to its title and emoji icon', () => {
    const pages = new PageRegistry(seed());

    expect(pages.info('guide')).toEqual({ title: 'Guide', icon: { type: 'emoji', value: '📘' }, path: ['Blok'] });
    expect(pages.info('keys')).toEqual({ title: 'Keys', path: ['Blok', 'Guide'] });
    expect(pages.info('nope')).toBeNull();
  });

  it('keeps edits in localStorage, so a new registry sees them', () => {
    const first = new PageRegistry(seed());

    first.setTitle('guide', 'Handbook');
    first.setIcon('guide', undefined);
    first.create('fresh', 'guide');
    first.setBlocks('fresh', [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }]);

    const second = new PageRegistry(seed());

    expect(second.info('guide')).toEqual({ title: 'Handbook', path: ['Blok'] });
    expect(second.get('fresh')).toEqual({
      title: '',
      parentId: 'guide',
      blocks: [{ id: 'f1', type: 'paragraph', data: { text: 'New' } }],
    });
    expect(JSON.parse(localStorage.getItem(PAGES_STORAGE_KEY) ?? '{}')).toHaveProperty('fresh');
  });

  it('keeps an in-tab edit after storage rejects it while merging unrelated tab edits', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    here.setTitle('guide', 'Saved older');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setTitle('guide', 'Unsaved newer');
    otherTab.setTitle('keys', 'Peer keys');
    here.reload();
    here.setIcon('guide', '🌿');

    expect(here.get('guide')).toMatchObject({ title: 'Unsaved newer', icon: '🌿' });
    expect(here.get('keys')?.title).toBe('Peer keys');
    expect(new PageRegistry(seed()).get('guide')).toMatchObject({ title: 'Unsaved newer', icon: '🌿' });
    expect(new PageRegistry(seed()).get('keys')?.title).toBe('Peer keys');
  });

  it('keeps a peer body change when an unsaved local title is reloaded', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const peerBlocks = [{ id: 'peer-block', type: 'paragraph', data: { text: 'Peer body' } }];

    here.setTitle('guide', 'Saved older');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setTitle('guide', 'Unsaved newer');
    otherTab.setBlocks('guide', peerBlocks);
    here.reload();

    expect(here.get('guide')?.blocks).toEqual(peerBlocks);
    expect(here.get('guide')?.title).toBe('Unsaved newer');
    here.setIcon('guide', '🌿');
    expect(new PageRegistry(seed()).get('guide')).toMatchObject({ title: 'Unsaved newer', blocks: peerBlocks });
  });

  it('keeps a peer title when a local icon removal cannot be stored', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setIcon('guide', undefined);
    otherTab.setTitle('guide', 'Peer title');
    here.reload();

    expect(here.get('guide')?.title).toBe('Peer title');
    expect(here.get('guide')).not.toHaveProperty('icon');
    here.setBlocks('guide', []);
    expect(new PageRegistry(seed()).get('guide')).not.toHaveProperty('icon');
  });

  it('keeps a locally created page after its first storage write fails', () => {
    const pages = new PageRegistry(seed());

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    pages.create('fresh', 'guide');
    pages.reload();

    expect(pages.get('fresh')).toMatchObject({ title: '', parentId: 'guide' });
  });

  it('keeps an adopted page after its first storage write fails', () => {
    const pages = new PageRegistry(seed());

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    pages.adopt('peer', { title: 'Peer', parentId: 'guide' });
    pages.reload();

    expect(pages.get('peer')).toMatchObject({ title: 'Peer', parentId: 'guide' });
  });

  it('does not revive a remotely purged page with an unsaved local edit', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setTitle('guide', 'Unsaved');
    otherTab.purge('guide');
    here.reload();

    expect(here.get('guide')).toBeUndefined();
  });

  it('discards an unsaved edit after seeing a durable purge, even if Trash is reset later', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setTitle('guide', 'Unsaved');
    otherTab.purge('guide');
    here.reload();
    otherTab.reset();
    here.reload();

    expect(here.get('guide')?.title).toBe('Guide');
  });

  it('keeps a local purge after storage rejects both writes, then saves its tombstone', () => {
    const pages = new PageRegistry(seed());

    pages.create('other', null);
    pages.setTitle('guide', 'Stored title');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });

    pages.purge('guide');
    write.mockRestore();
    pages.reload();

    expect(pages.get('guide')).toBeUndefined();
    pages.setTitle('other', 'Changed');
    expect(new PageRegistry(seed()).get('guide')).toBeUndefined();
  });

  it('does not create or adopt a page with a durable purge tombstone', () => {
    const pages = new PageRegistry(seed());

    pages.purge('guide');
    pages.create('guide', null);
    pages.adopt('guide', { title: 'Stale link', parentId: null });

    expect(pages.get('guide')).toBeUndefined();
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

  it('adopts a page another tab made after this registry was read', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    otherTab.create('fresh', 'guide');
    otherTab.setTitle('fresh', 'Fresh');
    here.adopt('fresh', { parentId: null, title: 'Stale cache' });

    expect(here.get('fresh')).toEqual({ title: 'Fresh', parentId: 'guide', blocks: [] });
  });

  it('adopts a page with no record anywhere from the link that points at it', () => {
    const pages = new PageRegistry(seed());

    pages.adopt('peer', { parentId: 'guide', title: 'From a peer', icon: '🌱' });

    expect(pages.info('peer')).toEqual({ title: 'From a peer', icon: { type: 'emoji', value: '🌱' }, path: ['Blok', 'Guide'] });
    expect(new PageRegistry(seed()).has('peer')).toBe(true);
  });

  it('adopting keeps a record this tab already has', () => {
    const pages = new PageRegistry(seed());

    pages.adopt('guide', { parentId: 'keys', title: 'Other' });

    expect(pages.get('guide')).toMatchObject({ title: 'Guide', parentId: null });
  });

  it('reload picks up a page another tab made and renamed after this registry was read', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    otherTab.create('fresh', 'guide');
    otherTab.setTitle('fresh', 'Fresh');
    otherTab.setTitle(null, 'Home');
    here.reload();

    expect(here.info('fresh')).toEqual({ title: 'Fresh', path: ['Home', 'Guide'] });
  });

  it('reload tells only the pages whose title, icon or path changed', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const guide = vi.fn();
    const keys = vi.fn();
    const fresh = vi.fn();

    here.subscribe('guide', guide);
    here.subscribe('keys', keys);
    here.subscribe('fresh', fresh);
    otherTab.setBlocks('guide', []);
    here.reload();

    expect(guide).not.toHaveBeenCalled();

    otherTab.setTitle('guide', 'Handbook');
    otherTab.create('fresh', null);
    here.reload();

    expect(guide).toHaveBeenCalledTimes(1);
    // Its path holds the guide's title.
    expect(keys).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('a page stops hearing about changes once it unsubscribes', () => {
    const here = new PageRegistry(seed());
    const listener = vi.fn();

    here.subscribe('guide', listener)();
    new PageRegistry(seed()).setTitle('guide', 'Handbook');
    here.reload();

    expect(listener).not.toHaveBeenCalled();
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

  it('the root document header draws no title or icon of its own: Blok draws them', () => {
    const host = document.createElement('header');

    renderPageHeader(host, headerOptions(new PageRegistry(seed()), null));

    expect(host.hidden).toBe(false);
    expect(host.querySelector('h1')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector('nav')).toBeNull();
  });

  it('keeps the root title and icon in localStorage, and reset brings back the default', () => {
    const first = new PageRegistry(seed());

    first.setTitle(null, 'Workspace');
    first.setIcon(null, '🏠');

    const second = new PageRegistry(seed());

    expect(second.root()).toEqual({ title: 'Workspace', icon: '🏠' });
    second.reset();
    expect(second.root()).toEqual({ title: 'Blok' });
    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Blok' });
  });

  it('keeps an unsaved root title through reload and the next edit', () => {
    const pages = new PageRegistry(seed());

    pages.setTitle(null, 'Saved older');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    pages.setTitle(null, 'Unsaved newer');
    pages.reload();
    pages.setIcon(null, '🏠');

    expect(pages.root()).toEqual({ title: 'Unsaved newer', icon: '🏠' });
    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Unsaved newer', icon: '🏠' });
  });

  it('keeps a peer root icon alongside an unsaved local title', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    here.setTitle(null, 'Saved older');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    here.setTitle(null, 'Unsaved newer');
    otherTab.setIcon(null, '🏠');
    here.reload();

    expect(here.root()).toEqual({ title: 'Unsaved newer', icon: '🏠' });
    here.setTitle(null, 'Still newer');
    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Still newer', icon: '🏠' });
  });

  it('uses the default root after its stored record becomes unreadable', () => {
    const pages = new PageRegistry(seed());

    pages.setTitle(null, 'Workspace');
    localStorage.setItem(ROOT_STORAGE_KEY, '{');
    pages.reload();

    expect(pages.root()).toEqual({ title: 'Blok' });
  });

  it('an icon picked on the root does not pin the default title', () => {
    new PageRegistry(seed()).setIcon(null, '😭');

    expect(JSON.parse(localStorage.getItem(ROOT_STORAGE_KEY) ?? '{}')).toEqual({ icon: '😭' });
    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Blok', icon: '😭' });
  });

  it('a root saved under the old default title reads the current default', () => {
    localStorage.setItem(ROOT_STORAGE_KEY, JSON.stringify({ title: 'Playground', icon: '😭' }));

    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Blok', icon: '😭' });
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

  it('hands the clicked crumb to navigate, so the page can open from where it was clicked', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const options = headerOptions(pages, 'keys');

    renderPageHeader(host, options);
    const crumb = host.querySelector<HTMLAnchorElement>('a.pg-crumb');

    crumb?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(options.navigate).toHaveBeenCalledWith(null, crumb);
  });

  it('an empty root title reads New page in paths', () => {
    const pages = new PageRegistry(seed());

    pages.setTitle(null, '');

    expect(pages.info('guide')?.path).toEqual(['New page']);
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

  it('keeps a page out of trash while one of its entry points is left', () => {
    const pages = new PageRegistry(seed());
    const watch = new PointerWatch(pages);

    watch.observe([pointer('keys'), para, pointer('keys')]);
    watch.observe([para, pointer('keys')]);
    expect(pages.trashedIn('keys')).toBeNull();

    watch.observe([para]);
    expect(pages.trashedIn('keys')?.id).toBe('keys');
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

  it('builds a restored pointer without title or icon metadata', () => {
    const block = pointerBlock('guide');

    expect(block.type).toBe('page');
    expect(block.data).toEqual({ pageId: 'guide' });
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

  it('every rounded header control carries the radius tokens', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');

    pages.trash('keys');
    renderPageHeader(host, {
      pageId: 'keys',
      pages,
      search: '',
      readOnly: false,
      navigate: vi.fn(),
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

describe('playground follows a link to a page this tab has no record of', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('function goToPage(');
  const source = html.slice(from, html.indexOf('let blok = new Blok(', from));

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('does not create a blank local page from an unknown owning pointer', async () => {
    const pages = new PageRegistry(seed());
    const pushed: string[] = [];
    const linked = { guide: [{ id: 'foreign-block', type: 'page', data: { pageId: 'foreign' } }] };
    const context = {
      pages,
      editorPageId: null as string | null,
      currentPageId: null as string | null,
      pageBlocksOf: (id: string | null) => (id === null ? [{ id: 'g', type: 'page', data: { pageId: 'guide' } }] : linked[id as 'guide']),
      findPageLink: (await import('../../../src/playground/page-tree')).findPageLink,
      queueEditorWork: (work: () => Promise<void>) => work(),
      history: { pushState: (_state: unknown, _title: string, url: string) => pushed.push(url) },
      window: { location: { search: '' }, scrollY: 0, scrollTo: vi.fn() },
      document: { body: { getBoundingClientRect: () => ({ height: 0 }) }, getElementById: vi.fn(), querySelector: vi.fn() },
      pagePath,
      scrollByPage: new Map(),
      snapshotEditor: vi.fn(),
      runPageTransition: async (run: () => Promise<void>) => run(),
      swapEditor: vi.fn(),
      waitForPageContent: vi.fn(),
      renderHeader: vi.fn(),
      holdPageHeight: vi.fn(),
      pageNavMorphs: () => ({}),
      flashArrivalRow: vi.fn(),
      state: { readOnly: false },
      PAGE_CONTENT_WAIT_MS: 0,
    };

    await runInNewContext(`${source}; goToPage('foreign')`, context);

    expect(pages.get('foreign')).toBeUndefined();
    expect(pushed).toEqual([]);
  });
});

describe('playground opens a page from a link outside the editor', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('function goToPage(');
  const source = html.slice(from, html.indexOf('let blok = new Blok(', from));

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const navigate = async (link: unknown): Promise<Record<string, unknown>> => {
    const calls: Array<Record<string, unknown>> = [];
    const context = {
      pages: new PageRegistry(seed()),
      editorPageId: null as string | null,
      currentPageId: null as string | null,
      pageBlocksOf: () => [],
      findPageLink: () => null,
      queueEditorWork: (work: () => Promise<void>) => work(),
      history: { pushState: vi.fn() },
      window: { location: { search: '' }, scrollY: 0, scrollTo: vi.fn() },
      document: { body: { getBoundingClientRect: () => ({ height: 0 }) }, getElementById: vi.fn(), querySelector: vi.fn() },
      pagePath,
      scrollByPage: new Map(),
      snapshotEditor: vi.fn(),
      runPageTransition: async (run: () => Promise<void>, options: Record<string, unknown>) => {
        calls.push(options);
        await run();
      },
      swapEditor: vi.fn(),
      waitForPageContent: vi.fn(),
      renderHeader: vi.fn(),
      holdPageHeight: vi.fn(),
      pageNavMorphs: () => ({ from: 'row', to: 'header' }),
      flashArrivalRow: vi.fn(),
      state: { readOnly: false },
      PAGE_CONTENT_WAIT_MS: 0,
      link,
    };

    await runInNewContext(`${source}; goToPage('guide', { from: link })`, context);

    return calls[0];
  };

  it('grows the page out of the clicked row and morphs no part from the editor', async () => {
    const row = { getBoundingClientRect: () => ({ left: 20, top: 100, width: 200, height: 30 }) };

    expect(await navigate(row)).toMatchObject({ from: null, to: null, origin: { x: 120, y: 115 } });
  });

  it('keeps the row-to-header morph for a page link inside the editor', async () => {
    expect(await navigate(undefined)).toMatchObject({ from: 'row', to: 'header' });
  });
});

describe('playground follows a rename made in another tab', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const from = html.indexOf('keepPageHeaderAligned(pageHeader');
  const source = html.slice(from, html.indexOf('/** Takes a page out of Trash', from));

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const boot = (currentPageId: string | null = 'keys', { collab = false, remote = false } = {}) => {
    const listeners = new Map<string, (event: { key: string | null }) => void>();
    const pages = new PageRegistry(seed());
    const blok = {};
    const context = {
      pages,
      currentPageId,
      editorPageId: currentPageId,
      blok,
      remotePages: remote ? {} : null,
      collaborationConfig: () => (collab ? { doc: 'shared' } : null),
      pushRecord: vi.fn(),
      pageHeader: {},
      keepPageHeaderAligned: () => undefined,
      renderHeader: vi.fn(),
      updateDocumentTitle: vi.fn(),
      PAGES_STORAGE_KEY,
      ROOT_STORAGE_KEY,
      window: { addEventListener: (type: string, fn: (event: { key: string | null }) => void) => listeners.set(type, fn) },
      document: { getElementById: () => null },
    };

    runInNewContext(source, context);

    return { context, pages, blok, fire: (key: string | null) => listeners.get('storage')?.({ key }) };
  };

  it('picks up the new title, so page links and crumbs show it', () => {
    const tab = boot();

    new PageRegistry(seed()).setTitle('guide', 'Handbook');
    tab.fire(PAGES_STORAGE_KEY);

    expect(tab.pages.get('guide')?.title).toBe('Handbook');
    expect(tab.context.renderHeader).toHaveBeenCalledTimes(1);
  });

  it('a renamed root rebuilds the root page header', () => {
    const tab = boot(null);

    new PageRegistry(seed()).setTitle(null, 'Home');
    tab.fire(ROOT_STORAGE_KEY);

    expect(tab.context.renderHeader).toHaveBeenCalledTimes(1);
  });

  it('a block save in another tab leaves the header alone', () => {
    const tab = boot();

    new PageRegistry(seed()).setBlocks('guide', []);
    tab.fire(PAGES_STORAGE_KEY);

    expect(tab.context.renderHeader).not.toHaveBeenCalled();
    expect(tab.context.updateDocumentTitle).toHaveBeenCalledTimes(1);
  });

  it('pushes the open page\'s record into the editor', () => {
    const tab = boot('keys');

    new PageRegistry(seed()).setTitle('keys', 'Shortcuts');
    tab.fire(PAGES_STORAGE_KEY);

    expect(tab.context.pushRecord).toHaveBeenCalledWith(tab.blok, expect.objectContaining({ title: 'Shortcuts' }));
  });

  it('pushes the root record when the root is open', () => {
    const tab = boot(null);

    new PageRegistry(seed()).setTitle(null, 'Home');
    tab.fire(ROOT_STORAGE_KEY);

    expect(tab.context.pushRecord).toHaveBeenCalledWith(tab.blok, expect.objectContaining({ title: 'Home' }));
  });

  it('pushes nothing under collaboration or a remote host, which carry the title themselves', () => {
    const collab = boot('keys', { collab: true });
    const remote = boot('keys', { remote: true });

    new PageRegistry(seed()).setTitle('keys', 'Shortcuts');
    collab.fire(PAGES_STORAGE_KEY);
    remote.fire(PAGES_STORAGE_KEY);

    expect(collab.context.pushRecord).not.toHaveBeenCalled();
    expect(remote.context.pushRecord).not.toHaveBeenCalled();
  });

  it('ignores storage keys that are not the page registry', () => {
    const tab = boot();
    const reload = vi.spyOn(tab.pages, 'reload');

    tab.fire('blok-playground-state');

    expect(reload).not.toHaveBeenCalled();
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
      pageTree: { refresh: vi.fn() },
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
    // The page tree reads the live page blocks, so a failed save must not freeze it.
    expect(page.context.pageTree.refresh).toHaveBeenCalledTimes(1);
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

  it('keeps the header invisible until the text column can be measured, so it never jumps', () => {
    const column = document.createElement('div');
    const header = document.createElement('header');
    const holder = document.createElement('div');

    column.append(header, holder);
    document.body.append(column);
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(rect(100, 1000));

    keepPageHeaderAligned(header, holder);
    resize();

    expect(header.style.visibility).toBe('hidden');

    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(268, 720));
    holder.append(content);
    resize();

    expect(header.style.visibility).toBe('');
    expect(header.style.marginLeft).toBe('168px');

    content.remove();
    resize();

    expect(header.style.visibility).toBe('');
    expect(header.style.marginLeft).toBe('168px');
  });
});
