import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRegistry, ROOT_STORAGE_KEY, type PageMap } from '../../../src/playground/page-host';
import type { PageIcon } from '../../../types/tools/page';
import {
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
    const { onChange } = titleCallbacks({ pages, pageId: 'guide', changed });

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
    const { onChange, onIconChange } = titleCallbacks({ pages, pageId: 'guide', changed });

    onChange('Pushed', { source: 'api', record: false });
    onIconChange({ type: 'emoji', value: '🌿' }, { source: 'api', record: false });

    expect(setTitle).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('keeps writing to its own page after the playground moved to another', () => {
    const pages = new PageRegistry(seed());
    const current = { pageId: 'guide' };
    const { onChange } = titleCallbacks({ pages, pageId: current.pageId, changed: vi.fn() });

    current.pageId = 'keys';
    onChange('Late undo', { source: 'undo' });

    expect(pages.get('guide')?.title).toBe('Late undo');
    expect(pages.get('keys')?.title).toBe('Keys');
  });

  it('writes the root record for the root document', () => {
    const pages = new PageRegistry(seed());
    const { onChange, onIconChange } = titleCallbacks({ pages, pageId: null, changed: vi.fn() });

    onChange('Home', { source: 'user' });
    onIconChange({ type: 'emoji', value: '🏠' }, { source: 'user' });

    expect(pages.root()).toEqual({ title: 'Home', icon: '🏠' });
  });

  it('stores an emoji icon as its string and a removed or image icon as none', () => {
    const pages = new PageRegistry(seed());
    const { onIconChange } = titleCallbacks({ pages, pageId: 'guide', changed: vi.fn() });

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
