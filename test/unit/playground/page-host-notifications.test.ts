import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { OutputBlockData } from '../../../types';
import {
  PageRegistry,
  pointerBlock,
  type PageMap,
} from '../../../src/playground/page-host';
import { buildPageTree, findPageLink } from '../../../src/playground/page-tree';

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

  it('does not echo a stale profile title into shared history on connect or remote update', () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const pages = new PageRegistry(seed());
    const shared = new Y.Doc().getMap<string>('values');
    shared.set('title', 'Peer title');
    let changed: ((value: string, change: { source: string }) => void) | undefined;
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: (_key: string, callback: (value: string, change: { source: string }) => void) => {
        changed = callback;

        return { get: () => shared.get('title'), set: (value: string) => shared.set('title', value) };
      } },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    runInNewContext(`${source}; wireTitleHistory(editor)`, {
      editor,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
      document,
      PAGE_TITLE_SELECTOR: '#pg-page-title',
      renderHeader: vi.fn(),
      updateDocumentTitle: vi.fn(),
    });
    connected?.({ status: 'connected' });

    expect(shared.get('title')).toBe('Peer title');
    expect(pages.info('guide')?.title).toBe('Guide');

    shared.set('title', 'Peer renamed again');
    changed?.('Peer renamed again', { source: 'remote' });

    expect(shared.get('title')).toBe('Peer renamed again');
    expect(pages.info('guide')?.title).toBe('Guide');
  });

  it('undoes a local title edit to the local host title after a peer history value', () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const pages = new PageRegistry(seed());
    const doc = new Y.Doc();
    const shared = doc.getMap<string>('values');
    shared.set('title', 'Peer title');
    const undo = new Y.UndoManager(shared);
    const host = { recordTitle: (_value: string): void => undefined };
    let changed: ((value: string, change: { source: string }) => void) | undefined;
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: (_key: string, callback: (value: string, change: { source: string }) => void) => {
        changed = callback;

        return {
          get: () => shared.get('title'),
          set: (value: string, options?: { record?: boolean }) => {
            if (options?.record === false) doc.transact(() => shared.set('title', value), 'without-capture');
            else shared.set('title', value);
          },
        };
      } },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    runInNewContext(`${source}; wireTitleHistory(editor); host.recordTitle = (value) => titleHistory?.set(value)`, {
      editor,
      host,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
      document,
      PAGE_TITLE_SELECTOR: '#pg-page-title',
      renderHeader: vi.fn(),
    });
    connected?.({ status: 'connected' });
    pages.setTitle('guide', 'Local edit');
    host.recordTitle('Local edit');
    undo.undo();
    changed?.(shared.get('title') ?? '', { source: 'undo' });

    expect(pages.info('guide')?.title).toBe('Guide');
    expect(shared.get('title')).toBe('Guide');
  });

  it('keeps the local host title without seeding shared history at collaboration boot', () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const pages = new PageRegistry(seed());
    const set = vi.fn();
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: () => ({ get: () => 'Peer title', set }) },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    runInNewContext(`${source}; wireTitleHistory(editor)`, {
      editor,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
    });
    connected?.({ status: 'connected' });

    expect(pages.info('guide')?.title).toBe('Guide');
    expect(set).not.toHaveBeenCalled();
  });

  it('reloads the host record at collaboration connect without promoting the history mirror', () => {
    const pages = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const set = vi.fn();
    const notify = vi.fn();
    const renderHeader = vi.fn();
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: () => ({ get: () => 'Stale mirror', set }) },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    pages.subscribe('guide', notify);
    otherTab.setTitle('guide', 'Persisted newer');

    runInNewContext(`${source}; wireTitleHistory(editor)`, {
      editor,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
      renderHeader,
      document: { activeElement: null },
      PAGE_TITLE_SELECTOR: '#pg-page-title',
    });
    connected?.({ status: 'connected' });

    expect(pages.info('guide')?.title).toBe('Persisted newer');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(renderHeader).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it('leaves stale shared history untouched after loading a newer host title', () => {
    const pages = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const set = vi.fn();
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: () => ({ get: () => 'Stale mirror', set }) },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    otherTab.setTitle('guide', 'Persisted newer');
    runInNewContext(`${source}; wireTitleHistory(editor)`, {
      editor,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
      renderHeader: vi.fn(),
      document: { activeElement: null },
      PAGE_TITLE_SELECTOR: '#pg-page-title',
    });
    connected?.({ status: 'connected' });

    expect(set).not.toHaveBeenCalled();
    expect(pages.info('guide')?.title).toBe('Persisted newer');
  });

  it('does not promote a stale remote history event over the host title', () => {
    const pages = new PageRegistry(seed());
    const otherTab = new PageRegistry(seed());
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
    const start = html.indexOf('let titleHistory = null;');
    const source = html.slice(start, html.indexOf('/** Destroys the live editor', start));
    const set = vi.fn();
    const replaceTitleText = vi.fn();
    const updateDocumentTitle = vi.fn();
    const title = {};
    let changed: ((value: string, change: { source: string }) => void) | undefined;
    let connected: ((event: { status: string }) => void) | undefined;
    const editor = {
      history: { track: (_key: string, callback: (value: string, change: { source: string }) => void) => {
        changed = callback;

        return { get: () => 'Stale mirror', set };
      } },
      on: (_name: string, listener: (event: { status: string }) => void) => { connected = listener; },
    };

    runInNewContext(`${source}; wireTitleHistory(editor)`, {
      editor,
      pages,
      currentPageId: 'guide',
      editorPageId: 'guide',
      collaborationConfig: () => ({ doc: 'shared' }),
      document: { activeElement: null, querySelector: () => title },
      PAGE_TITLE_SELECTOR: '#pg-page-title',
      renderHeader: vi.fn(),
      replaceTitleText,
      updateDocumentTitle,
    });
    connected?.({ status: 'connected' });
    otherTab.setTitle('guide', 'Persisted newer');
    changed?.('Stale mirror', { source: 'remote' });

    expect(pages.info('guide')?.title).toBe('Persisted newer');
    expect(replaceTitleText).toHaveBeenCalledWith(title, 'Persisted newer');
    expect(updateDocumentTitle).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
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
