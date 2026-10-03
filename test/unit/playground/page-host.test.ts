import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18n } from '../../../types';
import { getCaretXPosition, isCaretAtFirstLine, isCaretAtLastLine, setCaretAtXPosition } from '../../../src/components/utils/caret';
import type * as Caret from '../../../src/components/utils/caret';
import {
  PAGES_STORAGE_KEY,
  ROOT_STORAGE_KEY,
  PageRegistry,
  PointerWatch,
  caretToFirstBlock,
  replaceTitleText,
  firstBlockKeydown,
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

// Line and x lookups need layout, which jsdom does not have.
vi.mock('../../../src/components/utils/caret', async (importOriginal) => ({
  ...await importOriginal<typeof Caret>(),
  isCaretAtFirstLine: vi.fn(() => true),
  isCaretAtLastLine: vi.fn(() => true),
  getCaretXPosition: vi.fn(() => null),
  setCaretAtXPosition: vi.fn(),
}));

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
    splitTitle: vi.fn(),
    toFirstBlock: vi.fn(),
    recordTitle: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
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

  const pressEnterAt = (title: HTMLElement, offset: number, end = offset): KeyboardEvent => {
    const text = title.firstChild ?? title;

    window.getSelection()?.setBaseAndExtent(text, offset, text, end);

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

    title.dispatchEvent(event);

    return event;
  };

  const renderRootTitle = (): { host: HTMLElement; title: HTMLElement; options: Parameters<typeof renderPageHeader>[1] } => {
    const host = document.createElement('header');
    const options = headerOptions(new PageRegistry(seed()), null);

    document.body.append(host);
    renderPageHeader(host, options);
    const title = host.querySelector<HTMLElement>('h1');

    if (title === null) {
      throw new Error('no title');
    }

    return { host, title, options };
  };

  it('records typing in the title as typing, and a paste as a step of its own', () => {
    const { host, title, options } = renderRootTitle();

    title.textContent = 'Bloke';
    title.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'e' }));

    expect(options.recordTitle).toHaveBeenLastCalledWith('Bloke', true);

    window.getSelection()?.setPosition(title.firstChild, 5);
    const paste = new Event('paste', { cancelable: true });

    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'd' } });
    title.dispatchEvent(paste);

    expect(options.recordTitle).toHaveBeenLastCalledWith('Bloked', false);
    host.remove();
  });

  it('Enter records the shortened title as a step before opening the block', () => {
    const { host, title, options } = renderRootTitle();
    const order: string[] = [];

    vi.mocked(options.recordTitle).mockImplementation((text, typing) => order.push(`record ${text} ${typing}`));
    vi.mocked(options.splitTitle).mockImplementation((html) => order.push(`split ${html}`));
    pressEnterAt(title, 2);

    expect(order).toEqual(['record Bl false', 'split ok']);
    host.remove();
  });

  it('Cmd+Z and Cmd+Shift+Z in the title run the editor history, not the browser\'s', () => {
    const { host, title, options } = renderRootTitle();
    const press = (init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });

      title.dispatchEvent(event);

      return event;
    };

    expect(press({ key: 'z', metaKey: true }).defaultPrevented).toBe(true);
    expect(options.undo).toHaveBeenCalledTimes(1);
    expect(press({ key: 'z', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'y', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(options.redo).toHaveBeenCalledTimes(2);
    expect(press({ key: 'y', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(options.redo).toHaveBeenCalledTimes(2);
    host.remove();
  });

  it('ArrowDown on the last line of the title goes to the first block at the same x', () => {
    const host = document.createElement('header');
    const options = headerOptions(new PageRegistry(seed()), null);

    document.body.append(host);
    renderPageHeader(host, options);
    const title = host.querySelector<HTMLElement>('h1');

    if (title === null) {
      throw new Error('no title');
    }
    vi.mocked(getCaretXPosition).mockReturnValueOnce(64);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    title.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(isCaretAtLastLine).toHaveBeenCalledWith(title);
    expect(options.toFirstBlock).toHaveBeenCalledWith(64);

    vi.mocked(isCaretAtLastLine).mockReturnValueOnce(false);
    const above = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    title.dispatchEvent(above);

    expect(above.defaultPrevented).toBe(false);
    expect(options.toFirstBlock).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('Enter at the end of the title opens an empty first block', () => {
    const host = document.createElement('header');
    const options = headerOptions(new PageRegistry(seed()), null);

    document.body.append(host);
    renderPageHeader(host, options);

    const title = host.querySelector<HTMLElement>('h1');

    if (title === null) {
      throw new Error('no title');
    }

    expect(pressEnterAt(title, 4).defaultPrevented).toBe(true);
    expect(options.splitTitle).toHaveBeenCalledWith('');
    expect(title.textContent).toBe('Blok');
    host.remove();
  });

  it('Enter mid-title moves the text after the caret into the new block', () => {
    const host = document.createElement('header');
    const pages = new PageRegistry(seed());
    const options = headerOptions(pages, null);

    document.body.append(host);
    renderPageHeader(host, options);
    const title = host.querySelector<HTMLElement>('h1');

    if (title === null) {
      throw new Error('no title');
    }
    title.textContent = 'Tom & <Jerry>';
    pressEnterAt(title, 3);

    expect(options.splitTitle).toHaveBeenCalledWith(' &amp; &lt;Jerry&gt;');
    expect(title.textContent).toBe('Tom');
    expect(pages.root().title).toBe('Tom');
    host.remove();
  });

  it('Enter over a selection in the title drops the selected text first', () => {
    const host = document.createElement('header');
    const options = headerOptions(new PageRegistry(seed()), null);

    document.body.append(host);
    renderPageHeader(host, options);
    const title = host.querySelector<HTMLElement>('h1');

    if (title === null) {
      throw new Error('no title');
    }
    pressEnterAt(title, 1, 2);

    expect(options.splitTitle).toHaveBeenCalledWith('ok');
    expect(title.textContent).toBe('B');
    host.remove();
  });

  it('the root document shows a title and an icon button, like a page', () => {
    const host = document.createElement('header');

    renderPageHeader(host, headerOptions(new PageRegistry(seed()), null));

    expect(host.hidden).toBe(false);
    expect(host.querySelector('h1')?.textContent).toBe('Blok');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Add icon');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector('nav')).toBeNull();
  });

  it('a root title typed in the header is saved', () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const options = headerOptions(pages, null);

    renderPageHeader(host, options);

    const title = host.querySelector('h1');

    if (title === null) throw new Error('no title');
    title.textContent = 'Workspace';
    title.dispatchEvent(new Event('input'));

    expect(pages.root().title).toBe('Workspace');
    expect(options.changed).toHaveBeenCalled();
  });

  it('clicking Add icon sets a random icon at once and opens the picker on it', async () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const i18n: I18n = { t: (key) => key, has: () => false, getEnglishTranslation: (key) => key, getLocale: () => 'en' };
    const options = { ...headerOptions(pages, null), i18n: vi.fn(() => ({ i18n, locale: 'en' })) };

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));

    renderPageHeader(host, options);
    host.querySelector<HTMLButtonElement>('button[aria-label="Add icon"]')?.click();
    await vi.waitFor(() => expect(pages.root().icon).toBeDefined());

    const icon = pages.root().icon;

    expect(icon).toMatch(/\p{Extended_Pictographic}/u);
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Change icon');
    expect(host.querySelector('button')?.textContent).toBe(icon);
    expect(options.changed).toHaveBeenCalled();
    expect(document.body.querySelector('[data-emoji-picker-random]')).not.toBeNull();
    // The open finishes async and still reads matchMedia.
    await vi.waitFor(() => expect(document.body.querySelector('[data-emoji-section-deferred]')).not.toBeNull());

    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('the page icon picker has no Callout section', async () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const i18n: I18n = { t: (key) => key, has: () => false, getEnglishTranslation: (key) => key, getLocale: () => 'en' };

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    pages.setIcon(null, '😭');
    document.body.append(host);
    renderPageHeader(host, { ...headerOptions(pages, null), i18n: vi.fn(() => ({ i18n, locale: 'en' })) });
    host.querySelector('button')?.click();
    await vi.waitFor(() => expect(document.body.querySelector('[data-emoji-section-deferred]')).not.toBeNull());

    expect(document.body.querySelector('[data-emoji-section="callout"]')).toBeNull();
    expect(document.body.querySelector('[data-emoji-section]')?.getAttribute('data-emoji-section')).toBe('people');

    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('the page icon picker starts where the icon starts', async () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const i18n: I18n = { t: (key) => key, has: () => false, getEnglishTranslation: (key) => key, getLocale: () => 'en' };

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    pages.setIcon(null, '😭');
    document.body.append(host);
    renderPageHeader(host, { ...headerOptions(pages, null), i18n: vi.fn(() => ({ i18n, locale: 'en' })) });

    const button = host.querySelector('button');

    if (button === null) throw new Error('no icon button');
    button.getBoundingClientRect = () => new DOMRect(120, 40, 78, 78);
    button.click();
    await vi.waitFor(() => expect(document.body.querySelector('[data-emoji-section-deferred]')).not.toBeNull());

    expect(document.body.querySelector<HTMLElement>('[data-emoji-picker-header]')?.closest<HTMLElement>('[style*="left"]')?.style.left).toBe('120px');

    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('the icon stays marked as open while its picker is open', async () => {
    const pages = new PageRegistry(seed());
    const host = document.createElement('header');
    const i18n: I18n = { t: (key) => key, has: () => false, getEnglishTranslation: (key) => key, getLocale: () => 'en' };

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    pages.setIcon(null, '😭');
    document.body.append(host);
    renderPageHeader(host, { ...headerOptions(pages, null), i18n: vi.fn(() => ({ i18n, locale: 'en' })) });

    const button = host.querySelector('button');

    if (button === null) throw new Error('no icon button');
    button.click();
    await vi.waitFor(() => expect(document.body.querySelector('[data-emoji-section-deferred]')).not.toBeNull());

    expect(button.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));

    document.body.replaceChildren();
    vi.unstubAllGlobals();
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
      splitTitle: vi.fn(),
      toFirstBlock: vi.fn(),
      recordTitle: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
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
      splitTitle: vi.fn(),
      toFirstBlock: vi.fn(),
      recordTitle: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
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
      splitTitle: vi.fn(),
      toFirstBlock: vi.fn(),
      recordTitle: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
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

  it('opens a page a peer linked from the open page', async () => {
    const pages = new PageRegistry(seed());
    const pushed: string[] = [];
    const linked = { guide: [{ id: 'p', type: 'page', data: { pageId: 'peer', cache: { title: 'From a peer' } } }] };
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
      PAGE_TITLE_SELECTOR: '',
    };

    await runInNewContext(`${source}; goToPage('peer')`, context);

    expect(pushed).toEqual(['/editor/page/peer']);
    expect(pages.get('peer')).toMatchObject({ title: 'From a peer', parentId: 'guide' });
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

describe('firstBlockKeydown', () => {
  interface Setup {
    title: HTMLElement;
    editable: HTMLElement;
    remove: ReturnType<typeof vi.fn>;
    press: (key?: string) => { event: KeyboardEvent; handled: boolean };
  }

  const setup = (text: string, caret: number, options: { children?: unknown[]; fields?: number } = {}): Setup => {
    const title = document.createElement('h1');

    title.id = 'pg-page-title';
    title.contentEditable = 'true';
    // jsdom only focuses an element with a tabindex.
    title.tabIndex = 0;
    title.textContent = 'Blok';

    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    const fields = Array.from({ length: options.fields ?? 1 }, () => {
      const field = document.createElement('div');

      field.setAttribute('contenteditable', 'true');
      holder.append(field);

      return field;
    });
    const editable = fields[0];

    editable.textContent = text;
    document.body.append(title, holder);
    window.getSelection()?.setPosition(editable.firstChild ?? editable, caret);

    const remove = vi.fn(() => Promise.resolve());
    const press = (key = 'Backspace'): { event: KeyboardEvent; handled: boolean } => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      const handled = firstBlockKeydown(event, {
        blocks: {
          getBlockByIndex: (index: number) => (index === 0 ? { id: 'first', holder, isEmpty: text === '' } : undefined),
          getChildren: (parentId: string) => (parentId === 'first' ? options.children ?? [] : []),
          delete: remove,
        },
      });

      return { event, handled };
    };

    return { title, editable, remove, press };
  };

  const caretOffsetInTitle = (title: HTMLElement): number | null => {
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;

    if (selection === null || node === null || !selection.isCollapsed || !title.contains(node)) {
      return null;
    }

    const before = document.createRange();

    before.setStart(title, 0);
    before.setEnd(node, selection.anchorOffset);

    return before.toString().length;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Backspace removes an empty first block and puts the caret at the end of the title', () => {
    const { title, remove, press } = setup('', 0);
    const { event, handled } = press();

    expect(handled).toBe(true);
    expect(remove).toHaveBeenCalledWith(0, false);
    expect(event.defaultPrevented).toBe(true);
    expect(title.textContent).toBe('Blok');
    expect(caretOffsetInTitle(title)).toBe(4);
  });

  it('Backspace moves the first block\'s text into the title, caret at the join', () => {
    const { title, remove, press } = setup(' rocks', 0);

    expect(press().handled).toBe(true);
    expect(title.textContent).toBe('Blok rocks');
    expect(remove).toHaveBeenCalledWith(0, false);
    expect(caretOffsetInTitle(title)).toBe(4);
  });

  it('Backspace writes the title while the caret is still in the block, so undo returns it there', () => {
    const { title, editable, press } = setup(' rocks', 0);
    let caretInBlock: boolean | null = null;

    // jsdom's focus() leaves the selection alone; a browser's moves it into the title.
    title.addEventListener('input', () => {
      caretInBlock = document.activeElement !== title && editable.contains(window.getSelection()?.anchorNode ?? null);
    });
    press();

    expect(caretInBlock).toBe(true);
  });

  it('Backspace keeps a first block that has children and only moves the caret', () => {
    const { title, remove, press } = setup('Hello', 0, { children: [{ id: 'child' }] });

    expect(press().handled).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(title.textContent).toBe('Blok');
    expect(caretOffsetInTitle(title)).toBe(4);
  });

  it('Backspace keeps a first block with more than one field, like a captioned image', () => {
    const { title, remove, press } = setup('Caption', 0, { fields: 2 });

    expect(press().handled).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(title.textContent).toBe('Blok');
  });

  it('leaves Backspace alone when the caret is inside the text', () => {
    const { remove, press } = setup('Hello', 2);
    const { event, handled } = press();

    expect(handled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves Backspace alone outside the first block', () => {
    const { remove, press } = setup('', 0);
    const other = document.createElement('div');

    other.setAttribute('contenteditable', 'true');
    document.body.append(other);
    window.getSelection()?.setPosition(other, 0);

    expect(press().handled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('leaves Backspace alone inside a block nested in the first block', () => {
    const { editable, remove, press } = setup('Hello', 0);
    const nested = document.createElement('div');
    const field = document.createElement('div');

    nested.setAttribute('data-blok-element', '');
    field.setAttribute('contenteditable', 'true');
    nested.append(field);
    editable.parentElement?.append(nested);
    window.getSelection()?.setPosition(field, 0);

    expect(press().handled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('leaves Backspace alone over a selection', () => {
    const { editable, remove, press } = setup('Hello', 0);

    window.getSelection()?.setBaseAndExtent(editable, 0, editable, 1);

    expect(press().handled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('ArrowUp on the first line goes to the title at the same x', () => {
    const { title, editable, press } = setup('Hello', 3);

    vi.mocked(getCaretXPosition).mockReturnValueOnce(120);
    const { event, handled } = press('ArrowUp');

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(isCaretAtFirstLine).toHaveBeenCalledWith(editable);
    expect(setCaretAtXPosition).toHaveBeenCalledWith(title, 120, false);
  });

  it('ArrowUp without a caret x lands at the end of the title', () => {
    const { title, press } = setup('Hello', 3);

    expect(press('ArrowUp').handled).toBe(true);
    expect(caretOffsetInTitle(title)).toBe(4);
  });

  it('leaves ArrowUp alone below the first line', () => {
    const { press } = setup('Hello', 3);

    vi.mocked(isCaretAtFirstLine).mockReturnValueOnce(false);
    const { event, handled } = press('ArrowUp');

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('caretToFirstBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const editor = (field: HTMLElement | null): Parameters<typeof caretToFirstBlock>[0] => {
    const holder = document.createElement('div');

    if (field !== null) {
      holder.append(field);
    }

    return {
      blocks: { getBlockByIndex: () => ({ holder }) },
      caret: { setToFirstBlock: vi.fn(() => true) },
    };
  };

  it('puts the caret on the first line of the first block at the given x', () => {
    const field = document.createElement('div');

    field.setAttribute('contenteditable', 'true');
    const target = editor(field);

    caretToFirstBlock(target, 80);

    expect(target.caret.setToFirstBlock).toHaveBeenCalledWith('start');
    expect(setCaretAtXPosition).toHaveBeenCalledWith(field, 80, true);
  });

  it('falls back to the start of the first block without an x', () => {
    const target = editor(null);

    caretToFirstBlock(target, null);

    expect(target.caret.setToFirstBlock).toHaveBeenCalledWith('start');
    expect(setCaretAtXPosition).not.toHaveBeenCalled();
  });
});

describe('replaceTitleText', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the caret where it was when a peer changes the title being typed in', () => {
    const title = document.createElement('h1');

    title.tabIndex = 0;
    title.textContent = 'Blok';
    document.body.append(title);
    title.focus();
    window.getSelection()?.setPosition(title.firstChild, 2);

    replaceTitleText(title, 'Blok rocks');

    expect(title.textContent).toBe('Blok rocks');
    expect(window.getSelection()?.anchorNode).toBe(title.firstChild);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it('clamps the caret to a shorter title and leaves focus alone elsewhere', () => {
    const title = document.createElement('h1');
    const other = document.createElement('input');

    title.tabIndex = 0;
    title.textContent = 'Blok rocks';
    document.body.append(title, other);
    title.focus();
    window.getSelection()?.setPosition(title.firstChild, 9);

    replaceTitleText(title, 'Bl');

    expect(window.getSelection()?.anchorOffset).toBe(2);

    other.focus();
    replaceTitleText(title, 'B');

    expect(title.textContent).toBe('B');
    expect(other).toHaveFocus();
  });
});
