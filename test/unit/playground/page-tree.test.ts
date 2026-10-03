import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData } from '../../../types';
import { PageRegistry, type PageMap } from '../../../src/playground/page-host';
import { buildPageTree, mountPageTree, type PageTree } from '../../../src/playground/page-tree';

const pointer = (pageId: string): OutputBlockData => ({ id: `p-${pageId}`, type: 'page', data: { pageId } });

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [pointer('later'), pointer('keys')] },
  keys: { title: 'Keys', parentId: 'guide', blocks: [pointer('deep')] },
  later: { title: '', parentId: 'guide', blocks: [] },
  deep: { title: 'Deep', parentId: 'keys', blocks: [] },
  notes: { title: 'Notes', parentId: null, blocks: [] },
});

const rootBlocks = [pointer('notes'), pointer('guide')];

const blocksOf = (pages: PageRegistry) => (id: string | null): OutputBlockData[] =>
  id === null ? rootBlocks : (pages.get(id)?.blocks ?? []);

const titles = (nodes: Array<{ title: string }>): string[] => nodes.map((node) => node.title);

describe('buildPageTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('nests pages under the root document in the order their blocks sit in the parent', () => {
    const pages = new PageRegistry(seed());
    const tree = buildPageTree(pages, blocksOf(pages));

    expect(tree.id).toBeNull();
    expect(tree.title).toBe('Blok');
    expect(titles(tree.children)).toEqual(['Notes', 'Guide']);
    expect(titles(tree.children[1].children)).toEqual(['Untitled', 'Keys']);
    expect(titles(tree.children[1].children[1].children)).toEqual(['Deep']);
  });

  it('leaves out a page its parent has no block for, as the root forgets its pages on reload', () => {
    const pages = new PageRegistry(seed());
    const tree = buildPageTree(pages, (id) => (id === null ? [pointer('guide')] : (pages.get(id)?.blocks ?? [])));

    expect(titles(tree.children)).toEqual(['Guide']);
  });

  it('leaves out a trashed page and everything under it', () => {
    const pages = new PageRegistry(seed());

    pages.trash('keys');

    const guide = buildPageTree(pages, blocksOf(pages)).children[1];

    expect(titles(guide.children)).toEqual(['Untitled']);
  });

  it('stops when pages link each other in a loop', () => {
    const pages = new PageRegistry({
      a: { title: 'A', parentId: null, blocks: [pointer('b')] },
      b: { title: 'B', parentId: 'a', blocks: [pointer('a')] },
    });
    const tree = buildPageTree(pages, (id) => (id === null ? [pointer('a')] : pages.get(id)?.blocks));

    expect(titles(tree.children)).toEqual(['A']);
    expect(titles(tree.children[0].children)).toEqual(['B']);
    expect(tree.children[0].children[0].children).toEqual([]);
  });

  it('shows a linked page this browser has no record of, titled from its block', () => {
    const pages = new PageRegistry(seed());
    const linked: OutputBlockData = {
      id: 'p-elsewhere',
      type: 'page',
      data: { pageId: 'elsewhere', cache: { title: 'Made elsewhere', icon: { type: 'emoji', value: '🧭' } } },
    };
    const bare: OutputBlockData = { id: 'p-bare', type: 'page', data: { pageId: 'bare' } };
    const tree = buildPageTree(pages, (id) => (id === null ? [linked, bare, pointer('notes')] : pages.get(id)?.blocks));

    expect(titles(tree.children)).toEqual(['Made elsewhere', 'Untitled', 'Notes']);
    expect(tree.children[0].icon).toBe('🧭');
  });

  it('prefers the record over the block cache, which can lag behind a rename', () => {
    const pages = new PageRegistry(seed());
    const stale: OutputBlockData = { id: 'p-notes', type: 'page', data: { pageId: 'notes', cache: { title: 'Old name' } } };

    expect(titles(buildPageTree(pages, (id) => (id === null ? [stale] : [])).children)).toEqual(['Notes']);
  });

  it('lists a page once even when its parent links it twice', () => {
    const pages = new PageRegistry(seed());

    expect(titles(buildPageTree(pages, (id) => (id === null ? [pointer('notes'), pointer('notes')] : [])).children)).toEqual(['Notes']);
  });
});

describe('mountPageTree', () => {
  let pages: PageRegistry;
  let current: string | null;
  let navigate: ReturnType<typeof vi.fn<(id: string | null) => void>>;
  let tree: PageTree;

  const panel = (): HTMLElement => {
    const found = document.getElementById('pg-pages-panel');

    if (found === null) {
      throw new Error('No pages panel');
    }

    return found;
  };

  const row = (title: string): HTMLAnchorElement => {
    const link = [...panel().querySelectorAll<HTMLAnchorElement>('a.pg-tree-link')]
      .find((a) => a.textContent?.includes(title));

    if (link === undefined) {
      throw new Error(`No row ${title}`);
    }

    return link;
  };

  const toggleOf = (title: string): HTMLButtonElement => {
    const button = row(title).closest('.pg-tree-row')?.querySelector<HTMLButtonElement>('button.pg-tree-toggle');

    if (button === null || button === undefined) {
      throw new Error(`No toggle for ${title}`);
    }

    return button;
  };

  const visibleTitles = (): string[] => [...panel().querySelectorAll<HTMLElement>('a.pg-tree-link')]
    .filter((a) => a.closest('[hidden]') === null)
    .map((a) => a.querySelector('.pg-tree-title')?.textContent ?? '');

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
    pages = new PageRegistry(seed());
    current = 'keys';
    navigate = vi.fn<(id: string | null) => void>();
    tree = mountPageTree({
      pages,
      blocksOf: blocksOf(pages),
      currentPageId: () => current,
      href: (id) => (id === null ? '/editor' : `/editor/page/${id}`),
      navigate,
    });
  });

  afterEach(() => {
    tree.destroy();
    vi.restoreAllMocks();
  });

  it('is hidden until opened', () => {
    expect(panel().hidden).toBe(false);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(panel().inert).toBe(true);
    expect(tree.isOpen()).toBe(false);

    tree.open();

    expect(tree.isOpen()).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBeNull();
    expect(panel().inert).toBe(false);
  });

  it('opens from its tab and closes from its close button', () => {
    document.getElementById('pg-pages-tab')?.click();
    expect(tree.isOpen()).toBe(true);

    panel().querySelector<HTMLButtonElement>('.pg-pages-close')?.click();
    expect(tree.isOpen()).toBe(false);
  });

  it('expands the ancestors of an open page this browser has no record of', () => {
    tree.destroy();
    localStorage.clear();
    const linked: OutputBlockData = { id: 'p-x', type: 'page', data: { pageId: 'x', cache: { title: 'X' } } };
    const inner: OutputBlockData = { id: 'p-y', type: 'page', data: { pageId: 'y', cache: { title: 'Y' } } };

    current = 'y';
    tree = mountPageTree({
      pages,
      blocksOf: (id) => ({ root: [linked], x: [inner] }[id ?? 'root'] ?? []),
      currentPageId: () => current,
      href: () => '#',
      navigate,
    });

    expect(visibleTitles()).toEqual(['Blok', 'X', 'Y']);
    expect(row('Y').getAttribute('aria-current')).toBe('page');
  });

  it('expands the ancestors once the open page shows up, when its document loads late', () => {
    tree.destroy();
    localStorage.clear();
    const linked: OutputBlockData = { id: 'p-x', type: 'page', data: { pageId: 'x', cache: { title: 'X' } } };
    const inner: OutputBlockData = { id: 'p-y', type: 'page', data: { pageId: 'y', cache: { title: 'Y' } } };
    const state = { loaded: false };

    current = 'y';
    tree = mountPageTree({
      pages,
      blocksOf: (id) => (state.loaded ? ({ root: [linked], x: [inner] }[id ?? 'root'] ?? []) : []),
      currentPageId: () => current,
      href: () => '#',
      navigate,
    });
    state.loaded = true;
    tree.refresh();

    expect(visibleTitles()).toEqual(['Blok', 'X', 'Y']);
  });

  it('expands the ancestors of the open page and marks it current', () => {
    expect(visibleTitles()).toEqual(['Blok', 'Notes', 'Guide', 'Untitled', 'Keys']);
    expect(row('Keys').getAttribute('aria-current')).toBe('page');
    expect(row('Guide').hasAttribute('aria-current')).toBe(false);
  });

  it('links each row to its page', () => {
    expect(row('Keys').getAttribute('href')).toBe('/editor/page/keys');
    expect(row('Blok').getAttribute('href')).toBe('/editor');
  });

  it('expands and collapses a page from its toggle, and remembers it', () => {
    expect(toggleOf('Keys').getAttribute('aria-expanded')).toBe('false');

    toggleOf('Keys').click();

    expect(toggleOf('Keys').getAttribute('aria-expanded')).toBe('true');
    expect(visibleTitles()).toContain('Deep');

    tree.destroy();
    tree = mountPageTree({ pages, blocksOf: blocksOf(pages), currentPageId: () => null, href: () => '#', navigate });

    expect(visibleTitles()).toContain('Deep');

    toggleOf('Guide').click();

    expect(visibleTitles()).toEqual(['Blok', 'Notes', 'Guide']);
  });

  it('gives a page with no sub-pages no toggle', () => {
    expect(row('Notes').closest('.pg-tree-row')?.querySelector('button.pg-tree-toggle')).toBeNull();
  });

  it('navigates on a plain click and leaves a modifier click to the browser', () => {
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    row('Notes').dispatchEvent(plain);

    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('notes');

    const withMeta = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });

    row('Blok').dispatchEvent(withMeta);

    expect(withMeta.defaultPrevented).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('shows new titles and the new current page after a refresh', () => {
    pages.setTitle('notes', 'Renamed');
    current = 'notes';
    tree.refresh();

    expect(row('Renamed').getAttribute('aria-current')).toBe('page');
    expect(row('Keys').hasAttribute('aria-current')).toBe(false);
  });

  it('shows the page emoji, or the page glyph when there is none', () => {
    expect(row('Guide').querySelector('.pg-tree-icon')?.textContent).toBe('📘');
    expect(row('Notes').querySelector('.pg-tree-icon svg')).not.toBeNull();
  });

  it('closes on Escape, unless something else already took the key', () => {
    tree.open();

    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    taken.preventDefault();
    document.dispatchEvent(taken);
    expect(tree.isOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(tree.isOpen()).toBe(false);
  });

  it('lets a document Escape handler added later take the key first, so one Escape closes one layer', () => {
    const settingsEscape = (event: KeyboardEvent): void => event.preventDefault();

    tree.open();
    document.addEventListener('keydown', settingsEscape);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', settingsEscape);

    expect(tree.isOpen()).toBe(true);
  });

  it('hides its tab and panel away from the editor page', () => {
    tree.open();
    tree.setAvailable(false);

    expect(tree.isOpen()).toBe(false);
    expect(document.getElementById('pg-pages-tab')?.hidden).toBe(true);

    tree.toggle();
    expect(tree.isOpen()).toBe(false);

    tree.setAvailable(true);

    expect(document.getElementById('pg-pages-tab')?.hidden).toBe(false);
  });
});

describe('page tree styles', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/playground/page-tree.css'), 'utf-8');

  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);

    if (match === null) {
      throw new Error(`No rule for ${selector}`);
    }

    return match[1];
  };

  it('marks the current page with a neutral fill and the same ink as other rows, never blue', () => {
    const currentRule = block('.pg-tree-link[aria-current="page"]');

    expect(currentRule).toMatch(/background:\s*var\(--pg-tree-current\)/);
    expect(currentRule).not.toMatch(/(?:^|[^-])color:/);
    expect(css).not.toMatch(/#(?:2383e2|0b6e99|2eaadc|3b82f6)/i);
  });

  it('shows a focus ring only after keyboard use', () => {
    expect(css).toMatch(/html\[data-pg-modality="keyboard"\][^{]*\.pg-tree-link:focus-visible/);
  });
});
