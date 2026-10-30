import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconArrowDiagonal } from '../../../../src/components/icons';
import { PageLink } from '../../../../src/tools';
import type { PageConfig, PageSearchResult } from '../../../../src/tools/page/types';
import type { API, ToolboxConfigEntry } from '../../../../types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const api = { i18n: { t: (key: string) => key } } as unknown as API;

const entries = (): ToolboxConfigEntry[] => {
  const toolbox = PageLink.toolbox;

  return Array.isArray(toolbox) ? toolbox : [toolbox];
};

const searchInput = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>('[data-blok-testid="page-picker-search-input"]');

const options = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[data-blok-testid="page-picker-option"]')];

const type = (value: string): void => {
  const input = searchInput();

  if (input === null) {
    throw new Error('no search field');
  }
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const press = (key: string): void => {
  searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('PageLink toolbox entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is "Link to page" in Basic blocks, with the arrow icon and a drawing', () => {
    const [entry] = entries();

    expect(entries()).toHaveLength(1);
    expect(entry.titleKey).toBe('pageLink');
    expect(entry.section).toBe('basic');
    expect(entry.icon).toBe(IconArrowDiagonal);
    expect(entry.searchTerms).toEqual(expect.arrayContaining(['link to page', 'link', 'page']));
    expect(entry.preview?.descriptionKey).toBe('toolbox.preview.pageLink');
  });

  it('shows only when page-link has a search hook', () => {
    const search = (): Promise<PageSearchResult[]> => Promise.resolve([]);

    expect(PageLink.filterToolbox(entries(), {})).toEqual([]);
    expect(PageLink.filterToolbox(entries(), { resolve: () => null })).toEqual([]);
    expect(PageLink.filterToolbox(entries(), { search })).toEqual(entries());
  });

  it('has no prepareInsert, so API and agent inserts take their pageId as is', () => {
    expect(PageLink).not.toHaveProperty('prepareInsert');
  });
});

describe('PageLink.pickInsert', () => {
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('div');
    anchor.contentEditable = 'true';
    document.body.append(anchor);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const pick = (config: PageConfig, signal = new AbortController().signal): Promise<{ pageId: string }> =>
    PageLink.pickInsert(config, { api, anchor, signal });

  it('opens a picker with its own search field and lists every visible page', async () => {
    const search = vi.fn((_query: string) => Promise.resolve<PageSearchResult[]>([
      { pageId: 'p1', title: 'Roadmap', path: ['Work'], status: 'draft' },
      { pageId: 'p2', title: 'Secret', access: 'none' },
    ]));

    void pick({ search }).catch(() => undefined);
    await flush();

    expect(searchInput()).toHaveFocus();
    expect(searchInput()?.placeholder).toBe('tools.page.search');
    expect(search).toHaveBeenCalledWith('');
    expect(options().map((option) => option.textContent)).toEqual(['Roadmaptools.page.draftWork']);
  });

  it('filters by resolve, as "@" does', async () => {
    const config: PageConfig = {
      search: () => Promise.resolve([{ pageId: 'p1', title: 'Old' }, { pageId: 'p2', title: 'Gone' }]),
      resolve: (pageId) => (pageId === 'p1' ? { title: 'Roadmap' } : null),
    };

    void pick(config).catch(() => undefined);
    await flush();

    expect(options().map((option) => option.textContent)).toEqual(['Roadmap']);
  });

  it('searches as the user types and ignores a slower, older answer', async () => {
    const answers = new Map<string, (results: PageSearchResult[]) => void>();
    const search = (query: string): Promise<PageSearchResult[]> =>
      new Promise((resolve) => answers.set(query, resolve));

    void pick({ search }).catch(() => undefined);
    type('road');
    answers.get('road')?.([{ pageId: 'p1', title: 'Roadmap' }]);
    await flush();
    answers.get('')?.([{ pageId: 'p9', title: 'Everything' }]);
    await flush();

    expect(options().map((option) => option.textContent)).toEqual(['Roadmap']);
  });

  it('shows Nothing found when no page matches', async () => {
    void pick({ search: () => Promise.resolve([]) }).catch(() => undefined);
    await flush();

    const empty = document.querySelector('[data-blok-testid="popover-nothing-found"]');

    expect(empty?.classList.contains('hidden')).toBe(false);
    expect(empty?.textContent).toContain('popover.nothingFound');
  });

  it('answers the picked page and closes', async () => {
    const picked = pick({ search: () => Promise.resolve([{ pageId: 'p1', title: 'Roadmap' }]) });

    await flush();
    press('Enter');

    await expect(picked).resolves.toEqual({ pageId: 'p1' });
    expect(searchInput()).toBeNull();
  });

  it.each(['Escape', 'Tab'])('rejects on %s, so nothing is inserted', async (key) => {
    const picked = pick({ search: () => Promise.resolve([{ pageId: 'p1', title: 'Roadmap' }]) });

    await flush();
    press(key);

    await expect(picked).rejects.toThrow();
    expect(searchInput()).toBeNull();
  });

  it('rejects on a press outside the picker', async () => {
    const picked = pick({ search: () => Promise.resolve([]) });

    await flush();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    await expect(picked).rejects.toThrow();
  });

  it('rejects and closes when the editor goes away', async () => {
    const abort = new AbortController();
    const picked = pick({ search: () => Promise.resolve([]) }, abort.signal);

    await flush();
    abort.abort();

    await expect(picked).rejects.toThrow();
    expect(searchInput()).toBeNull();
  });

  it('rejects without opening when already aborted or without search', async () => {
    const abort = new AbortController();

    abort.abort();

    await expect(pick({ search: () => Promise.resolve([]) }, abort.signal)).rejects.toThrow();
    await expect(pick({})).rejects.toThrow();
    expect(searchInput()).toBeNull();
  });

  it('shows skeleton rows until the first answer', async () => {
    const answers: Array<(results: PageSearchResult[]) => void> = [];

    void pick({ search: () => new Promise((resolve) => answers.push(resolve)) }).catch(() => undefined);

    expect(document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]')).toHaveLength(2);
    answers[0]?.([{ pageId: 'p1', title: 'Roadmap' }]);
    await flush();

    expect(document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]')).toHaveLength(0);
  });

  it('draws the "@" rows: icon, six rows and a more-results row, and no New page section', async () => {
    const results = Array.from({ length: 8 }, (_, index) => ({
      pageId: `p${index}`, title: `Page ${index}`, icon: { type: 'emoji' as const, value: '🗺️' },
    }));

    void pick({ search: () => Promise.resolve(results), createFromMention: true, create: vi.fn() }).catch(() => undefined);
    await flush();

    expect(options()).toHaveLength(6);
    expect(options()[0]?.querySelector('[data-blok-testid="page-picker-option-icon"]')?.textContent).toBe('🗺️');
    expect(document.querySelector('[data-blok-testid="page-picker-new-sub-page"]')).toBeNull();
    document.querySelector<HTMLElement>('[data-blok-testid="page-picker-more"]')?.click();

    expect(options()).toHaveLength(8);
  });

  it('shows Nothing found when the search fails', async () => {
    void pick({ search: () => Promise.reject(new Error('down')) }).catch(() => undefined);
    await flush();

    expect(document.querySelector('[data-blok-testid="popover-nothing-found"]')?.classList.contains('hidden')).toBe(false);
  });
});
