import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRegistry, ROOT_STORAGE_KEY, type PageMap } from '../../../src/playground/page-host';
import type { PageIcon } from '../../../types/tools/page';
import {
  attachCreatedPageSeed,
  createdPageSeed,
  fromPageIcon,
  pushRecord,
  titleCallbacks,
  titleData,
  toPageIcon,
  type TitleEditor,
} from '../../../src/playground/page-title-wiring';

const seed = (): PageMap => ({
  guide: { title: 'Guide', icon: '📘', parentId: null, blocks: [] },
  keys: { title: 'Keys', parentId: 'guide', blocks: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('page icon mapping', () => {
  it('turns an emoji string into a page icon, and nothing into nothing', () => {
    expect(toPageIcon('🚀')).toEqual({ type: 'emoji', value: '🚀' });
    expect(toPageIcon('')).toBeUndefined();
    expect(toPageIcon(undefined)).toBeUndefined();
  });

  it('turns an emoji page icon back into its string, and never into an empty one', () => {
    expect(fromPageIcon({ type: 'emoji', value: '🚀' })).toBe('🚀');
    expect(fromPageIcon({ type: 'image', url: 'https://example.com/a.png' })).toBeUndefined();
    expect(fromPageIcon(null)).toBeUndefined();
  });
});

describe('titleData', () => {
  it('reads the root record for the root document', () => {
    localStorage.setItem(ROOT_STORAGE_KEY, JSON.stringify({ title: 'Home', icon: '🏠' }));

    expect(titleData(new PageRegistry(seed()), null)).toEqual({ title: 'Home', icon: { type: 'emoji', value: '🏠' } });
  });

  it('gives the root its default title and no icon when nothing is stored', () => {
    expect(titleData(new PageRegistry(seed()), null)).toEqual({ title: 'Blok' });
  });

  it('reads a child page through get, with and without an icon', () => {
    const pages = new PageRegistry(seed());

    expect(titleData(pages, 'guide')).toEqual({ title: 'Guide', icon: { type: 'emoji', value: '📘' } });
    expect(titleData(pages, 'keys')).toEqual({ title: 'Keys' });
  });

  it('reads through get, so an overlay that overrides get is what the editor gets', () => {
    const pages = new PageRegistry(seed());
    const overlay = {
      root: () => pages.root(),
      get: (id: string) => {
        const page = pages.get(id);

        return page === undefined ? undefined : { ...page, title: 'From host', icon: '🛰️' };
      },
    };

    expect(titleData(overlay, 'guide')).toEqual({ title: 'From host', icon: { type: 'emoji', value: '🛰️' } });
  });

  it('gives an empty title for a page the registry does not know', () => {
    expect(titleData(new PageRegistry(seed()), 'missing')).toEqual({ title: '' });
  });
});

describe('titleCallbacks', () => {
  it('writes every title change to the page it was built for, and redraws', () => {
    const pages = new PageRegistry(seed());
    const changed = vi.fn();
    const { onChange } = titleCallbacks({ pages, currentPageId: () => 'guide', changed });

    onChange('Typed', { source: 'user' });
    expect(pages.get('guide')?.title).toBe('Typed');
    onChange('Undone', { source: 'undo' });
    expect(pages.get('guide')?.title).toBe('Undone');
    onChange('From a peer', { source: 'remote' });
    expect(pages.get('guide')?.title).toBe('From a peer');
    onChange('Set by code', { source: 'api' });
    expect(pages.get('guide')?.title).toBe('Set by code');
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('skips the registry write for its own unrecorded set, but still redraws', () => {
    const pages = new PageRegistry(seed());
    const changed = vi.fn();
    const setTitle = vi.spyOn(pages, 'setTitle');
    const setIcon = vi.spyOn(pages, 'setIcon');
    const { onChange, onIconChange } = titleCallbacks({ pages, currentPageId: () => 'guide', changed });

    onChange('Pushed', { source: 'api', record: false });
    onIconChange({ type: 'emoji', value: '🌿' }, { source: 'api', record: false });

    expect(setTitle).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('a late remote or undo change from a page left behind writes only that page', () => {
    const pages = new PageRegistry(seed());
    const current: { pageId: string | null } = { pageId: 'guide' };
    const routed = vi.fn();
    const { onChange, onIconChange } = titleCallbacks({ pages, currentPageId: () => current.pageId, changed: vi.fn(), routed });

    current.pageId = 'keys';
    onChange('Peer title', { source: 'remote' });
    onIconChange({ type: 'emoji', value: '🌿' }, { source: 'remote' });
    onChange('Late undo', { source: 'undo' });
    onIconChange(null, { source: 'undo' });

    expect(pages.get('keys')).toEqual(seed().keys);
    expect(pages.get('guide')?.title).toBe('Late undo');
    expect(pages.get('guide')).not.toHaveProperty('icon');
    expect(routed.mock.calls.map(([pageId]: unknown[]) => pageId)).toEqual(['guide', 'guide']);
  });

  it('writes the root record for the root document', () => {
    const pages = new PageRegistry(seed());
    const { onChange, onIconChange } = titleCallbacks({ pages, currentPageId: () => null, changed: vi.fn() });

    onChange('Home', { source: 'user' });
    onIconChange({ type: 'emoji', value: '🏠' }, { source: 'user' });

    expect(pages.root()).toEqual({ title: 'Home', icon: '🏠' });
  });

  it('stores an emoji icon as its string and a removed or image icon as none', () => {
    const pages = new PageRegistry(seed());
    const { onIconChange } = titleCallbacks({ pages, currentPageId: () => 'guide', changed: vi.fn() });

    onIconChange({ type: 'emoji', value: '🌿' }, { source: 'user' });
    expect(pages.get('guide')?.icon).toBe('🌿');
    onIconChange(null, { source: 'undo' });
    expect(pages.get('guide')).not.toHaveProperty('icon');
    onIconChange({ type: 'image', url: 'https://example.com/a.png' }, { source: 'remote' });
    expect(pages.get('guide')).not.toHaveProperty('icon');
  });
});

describe('pushRecord', () => {
  const fakeEditor = (title: string, icon: PageIcon | null): {
    editor: TitleEditor;
    setTitle: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
  } => {
    const setTitle = vi.fn();
    const setIcon = vi.fn();

    return {
      editor: { title: { get: () => title, set: setTitle, icon: { get: () => icon, set: setIcon } } },
      setTitle,
      setIcon,
    };
  };

  it('pushes a changed title and icon without an undo step', () => {
    const { editor, setTitle, setIcon } = fakeEditor('Old', null);

    pushRecord(editor, { title: 'New', icon: '🌿' });

    expect(setTitle).toHaveBeenCalledWith('New', { record: false });
    expect(setIcon).toHaveBeenCalledWith({ type: 'emoji', value: '🌿' }, { record: false });
  });

  it('removes an icon the record no longer has', () => {
    const { editor, setIcon } = fakeEditor('Same', { type: 'emoji', value: '🌿' });

    pushRecord(editor, { title: 'Same' });

    expect(setIcon).toHaveBeenCalledWith(null, { record: false });
  });

  it('writes nothing when the editor already shows the record', () => {
    const { editor, setTitle, setIcon } = fakeEditor('Same', { type: 'emoji', value: '🌿' });

    pushRecord(editor, { title: 'Same', icon: '🌿' });

    expect(setTitle).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('leaves a title the user is typing in alone', () => {
    const { editor, setTitle } = fakeEditor('Typing', null);
    const title = document.createElement('h1');

    title.setAttribute('data-blok-page-title', '');
    title.tabIndex = -1;
    document.body.append(title);
    title.focus();

    pushRecord(editor, { title: 'Other tab' });

    expect(setTitle).not.toHaveBeenCalled();
    title.remove();
  });
});

describe('createdPageSeed', () => {
  const editorShowing = (title: string, icon: PageIcon | null = null): {
    editor: TitleEditor;
    setTitle: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
  } => {
    const setTitle = vi.fn();
    const setIcon = vi.fn();

    return { editor: { title: { get: () => title, set: setTitle, icon: { get: () => icon, set: setIcon } } }, setTitle, setIcon };
  };

  it('seeds a page this tab created into its empty room on connect, with no undo step', () => {
    const { editor, setTitle, setIcon } = editorShowing('');
    const onStatus = createdPageSeed(editor, { pageId: 'fresh', created: new Set(['fresh']), record: () => ({ title: 'Named here', icon: '🌱' }) });

    onStatus({ status: 'connected' });

    expect(setTitle).toHaveBeenCalledWith('Named here', { record: false });
    expect(setIcon).toHaveBeenCalledWith({ type: 'emoji', value: '🌱' }, { record: false });
  });

  it('never seeds a page that exists elsewhere: a stale title must not resurrect one a peer cleared', () => {
    const { editor, setTitle, setIcon } = editorShowing('');
    const onStatus = createdPageSeed(editor, { pageId: 'guide', created: new Set(['fresh']), record: () => ({ title: 'Stale', icon: '📘' }) });

    onStatus({ status: 'connected' });

    expect(setTitle).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('never seeds the root document', () => {
    const { editor, setTitle } = editorShowing('');
    const onStatus = createdPageSeed(editor, { pageId: null, created: new Set(['fresh']), record: () => ({ title: 'Root' }) });

    onStatus({ status: 'connected' });

    expect(setTitle).not.toHaveBeenCalled();
  });

  it('leaves a room that already has a title or icon alone', () => {
    const { editor, setTitle, setIcon } = editorShowing('From the room', { type: 'emoji', value: '🛰️' });
    const onStatus = createdPageSeed(editor, { pageId: 'fresh', created: new Set(['fresh']), record: () => ({ title: 'Local', icon: '🌱' }) });

    onStatus({ status: 'connected' });

    expect(setTitle).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('seeds once: a reconnect after a peer cleared the title does not bring it back', () => {
    const shown = { title: '' };
    const setTitle = vi.fn((value: string) => {
      shown.title = value;
    });
    const editor: TitleEditor = { title: { get: () => shown.title, set: setTitle, icon: { get: () => null, set: vi.fn() } } };
    const onStatus = createdPageSeed(editor, { pageId: 'fresh', created: new Set(['fresh']), record: () => ({ title: 'Named here' }) });

    onStatus({ status: 'connected' });
    shown.title = '';
    onStatus({ status: 'offline' });
    onStatus({ status: 'connected' });

    expect(setTitle).toHaveBeenCalledTimes(1);
  });

  it('waits for the room: no seed while connecting or offline', () => {
    const { editor, setTitle } = editorShowing('');
    const onStatus = createdPageSeed(editor, { pageId: 'fresh', created: new Set(['fresh']), record: () => ({ title: 'Named here' }) });

    onStatus({ status: 'connecting' });
    onStatus({ status: 'offline' });

    expect(setTitle).not.toHaveBeenCalled();
  });
});

describe('attachCreatedPageSeed', () => {
  const seededEditor = (): {
    editor: TitleEditor & { on(name: string, listener: (event: { status: string }) => void): void };
    setTitle: ReturnType<typeof vi.fn>;
    emit(status: string): void;
  } => {
    const shown = { title: '' };
    const listeners: Array<(event: { status: string }) => void> = [];
    const setTitle = vi.fn((value: string) => {
      shown.title = value;
    });

    return {
      editor: {
        title: { get: () => shown.title, set: setTitle, icon: { get: () => null, set: vi.fn() } },
        on: (_name, listener) => {
          listeners.push(listener);
        },
      },
      setTitle,
      emit: (status) => listeners.forEach((listener) => listener({ status })),
    };
  };
  const options = { pageId: 'fresh', created: new Set(['fresh']), record: () => ({ title: 'Named here' }) };

  it('seeds at once when the room connected before the listener was attached', () => {
    const { editor, setTitle } = seededEditor();

    attachCreatedPageSeed(editor, options, () => true);

    expect(setTitle).toHaveBeenCalledWith('Named here', { record: false });
  });

  it('waits for connected when the room has not connected yet', () => {
    const { editor, setTitle, emit } = seededEditor();

    attachCreatedPageSeed(editor, options, () => false);
    expect(setTitle).not.toHaveBeenCalled();

    emit('connecting');
    expect(setTitle).not.toHaveBeenCalled();

    emit('connected');
    expect(setTitle).toHaveBeenCalledWith('Named here', { record: false });
  });

  it('seeds once when it was already connected and the replayed status arrives too', () => {
    const { editor, setTitle, emit } = seededEditor();

    attachCreatedPageSeed(editor, options, () => true);
    emit('connected');

    expect(setTitle).toHaveBeenCalledTimes(1);
  });
});

