import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData } from '../../../types';
import {
  PageRegistry,
  pointerBlock,
  type PageMap,
} from '../../../src/playground/page-host';
import { buildPageTree, findPageLink } from '../../../src/playground/page-tree';
import { titleCallbacks } from '../../../src/playground/page-title-wiring';

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [] },
  child: { title: 'Child', parentId: 'guide', blocks: [] },
});

const link = (pageId: string, cache?: unknown): OutputBlockData => ({
  id: `block-${pageId}`,
  type: 'page',
  data: { pageId, ...(cache === undefined ? {} : { cache }) },
});

describe('playground page metadata notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('notifies subscribers once per changed title or icon in the same tab', () => {
    const pages = new PageRegistry(seed());
    const notify = vi.fn();
    const stop = pages.subscribe('guide', notify);

    pages.setTitle('guide', 'Renamed');
    expect(pages.info('guide')?.title).toBe('Renamed');
    expect(notify).toHaveBeenCalledTimes(1);

    pages.setTitle('guide', 'Renamed');
    expect(notify).toHaveBeenCalledTimes(1);

    pages.setIcon('guide', '🌿');
    expect(pages.info('guide')?.icon).toEqual({ type: 'emoji', value: '🌿' });
    expect(notify).toHaveBeenCalledTimes(2);

    pages.setIcon('guide', '🌿');
    expect(notify).toHaveBeenCalledTimes(2);

    stop();
    pages.setTitle('guide', 'After unsubscribe');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('notifies descendants when an ancestor or root changes, but not for body-only edits', () => {
    const pages = new PageRegistry(seed());
    const child = vi.fn();

    pages.subscribe('child', child);
    pages.setBlocks('guide', [link('child')]);
    expect(child).not.toHaveBeenCalled();

    pages.setTitle('guide', 'Handbook');
    expect(pages.info('child')?.path).toEqual(['Blok', 'Handbook']);
    expect(child).toHaveBeenCalledTimes(1);

    pages.setTitle(null, 'Home');
    expect(pages.info('child')?.path).toEqual(['Home', 'Handbook']);
    expect(child).toHaveBeenCalledTimes(2);
  });

  it('keeps remote storage reload notifications', () => {
    const here = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const notify = vi.fn();

    here.subscribe('guide', notify);
    otherTab.setTitle('guide', 'Remote name');
    expect(notify).not.toHaveBeenCalled();

    here.reload();
    expect(here.info('guide')?.title).toBe('Remote name');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite another tab’s title when editing an unrelated page', () => {
    const staleTab = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    otherTab.setTitle('guide', 'Persisted newer');
    staleTab.setTitle('child', 'Renamed child');

    const persisted = new PageRegistry(seed());

    expect(persisted.info('guide')?.title).toBe('Persisted newer');
    expect(persisted.info('child')?.title).toBe('Renamed child');
  });

  it.each([
    ['creating', (pages: PageRegistry) => { pages.create('created', null); }],
    ['adopting', (pages: PageRegistry) => { pages.adopt('adopted', { parentId: null, title: '' }); }],
    ['purging', (pages: PageRegistry) => { pages.purge('child'); }],
  ] as const)('does not overwrite another tab’s title when %s an unrelated page', (_action, change) => {
    const staleTab = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    otherTab.setTitle('guide', 'Persisted newer');
    change(staleTab);

    expect(new PageRegistry(seed()).info('guide')?.title).toBe('Persisted newer');
  });

  it('keeps another tab’s root title when adding an icon', () => {
    const staleTab = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());

    otherTab.setTitle(null, 'Persisted root');
    staleTab.setIcon(null, '🌿');

    expect(new PageRegistry(seed()).root()).toEqual({ title: 'Persisted root', icon: '🌿' });
  });

  it('notifies when a local page appears or disappears', () => {
    const pages = new PageRegistry(seed());
    const created = vi.fn();
    const adopted = vi.fn();
    const removed = vi.fn();

    pages.subscribe('created', created);
    pages.subscribe('adopted', adopted);
    pages.subscribe('guide', removed);

    pages.create('created', null);
    expect(pages.info('created')?.title).toBe('');
    expect(created).toHaveBeenCalledTimes(1);

    pages.adopt('adopted', { parentId: null, title: '' });
    expect(pages.info('adopted')?.title).toBe('');
    expect(adopted).toHaveBeenCalledTimes(1);

    pages.purge('guide');
    expect(pages.info('guide')).toBeNull();
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('notifies when reset replaces edited page metadata', () => {
    const pages = new PageRegistry(seed());
    const notify = vi.fn();

    pages.subscribe('guide', notify);
    pages.setTitle('guide', 'Edited');
    notify.mockClear();

    pages.reset();

    expect(pages.info('guide')?.title).toBe('Guide');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('delivers a tracked title revert to pointer and header redraw subscribers', () => {
    const pages = new PageRegistry(seed());
    const pointer = { title: '' };
    const header = { title: '' };
    const redrawPointer = vi.fn(() => {
      pointer.title = pages.info('guide')?.title ?? '';
    });
    const redrawHeader = vi.fn(() => {
      header.title = pages.get('guide')?.title ?? '';
    });

    pages.subscribe('guide', redrawPointer);
    pages.subscribe('guide', redrawHeader);

    pages.setTitle('guide', 'Edited');
    redrawPointer.mockClear();
    redrawHeader.mockClear();

    const trackedTitleChanged = (title: string): void => pages.setTitle('guide', title);

    trackedTitleChanged('Guide');

    expect(pointer.title).toBe('Guide');
    expect(header.title).toBe('Guide');
    expect(redrawPointer).toHaveBeenCalledTimes(1);
    expect(redrawHeader).toHaveBeenCalledTimes(1);
  });

  it('a peer\'s title reaches the registry, so links, crumbs and the tree follow', () => {
    const pages = new PageRegistry(seed());
    const notify = vi.fn();
    const changed = vi.fn();
    const { onChange } = titleCallbacks({ pages, pageId: 'guide', changed });

    pages.subscribe('guide', notify);
    onChange('Peer title', { source: 'remote' });

    expect(pages.info('guide')?.title).toBe('Peer title');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('an undo of a local edit writes the old title back to the registry', () => {
    const pages = new PageRegistry(seed());
    const { onChange } = titleCallbacks({ pages, pageId: 'guide', changed: vi.fn() });

    onChange('Local edit', { source: 'user' });
    onChange('Guide', { source: 'undo' });

    expect(pages.info('guide')?.title).toBe('Guide');
    expect(new PageRegistry(seed()).info('guide')?.title).toBe('Guide');
  });

  it('a restored version\'s title arrives as a remote change and becomes the registry title', () => {
    const pages = new PageRegistry(seed());
    const { onChange } = titleCallbacks({ pages, pageId: 'guide', changed: vi.fn() });

    onChange('Old title', { source: 'remote' });
    expect(pages.info('guide')?.title).toBe('Old title');

    // A point with no title: the restore removed the key, so the page is untitled again.
    onChange('', { source: 'remote' });
    expect(pages.info('guide')?.title).toBe('');
  });

  it('a value pushed from the registry is not written back to it', () => {
    const pages = new PageRegistry(seed());
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { onChange, onIconChange } = titleCallbacks({ pages, pageId: 'guide', changed: vi.fn() });

    onChange('From another tab', { source: 'api', record: false });
    onIconChange(null, { source: 'api', record: false });

    expect(setItem).not.toHaveBeenCalled();
    expect(pages.info('guide')?.title).toBe('Guide');
  });

  it('restored pointers carry only their page id', () => {
    expect(pointerBlock('guide').data).toEqual({ pageId: 'guide' });
  });

  it('does not use a pointer cache as a missing page name or icon', () => {
    const pages = new PageRegistry(seed());
    const parentBlocks = [link('unknown', { title: 'Private plan', icon: { type: 'emoji', value: '🔐' } })];
    const blocksOf = (id: string | null): OutputBlockData[] => id === null ? parentBlocks : [];

    expect(findPageLink(blocksOf, 'unknown')).toEqual({ parentId: null, title: '' });
    const tree = buildPageTree(pages, blocksOf);
    expect(tree.children[0]).toEqual({ id: 'unknown', title: 'New page', children: [] });
  });
});
