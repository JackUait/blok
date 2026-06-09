import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bookmark, type BookmarkData } from '../../../../src/tools/link/bookmark';
import type { BookmarkConfig } from '../../../../src/tools/link/metadata-fetcher';
import type { API, BlockToolConstructorOptions, PatternPasteEvent } from '../../../../types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createMockAPI = (): API =>
  ({
    i18n: { t: (key: string) => key, has: () => false },
  }) as unknown as API;

const createOptions = (
  data: Partial<BookmarkData> = {},
  config: BookmarkConfig = { endpoint: 'https://api.test/unfurl' }
): BlockToolConstructorOptions<BookmarkData, BookmarkConfig> =>
  ({
    api: createMockAPI(),
    block: {} as never,
    config,
    readOnly: false,
    data: data as BookmarkData,
  }) as BlockToolConstructorOptions<BookmarkData, BookmarkConfig>;

const patternEvent = (url: string): PatternPasteEvent =>
  ({ type: 'pattern', detail: { key: 'bookmark', data: url } }) as PatternPasteEvent;

const okResponse = (body: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

describe('Bookmark tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a generic http(s) URL paste pattern', () => {
    const config = Bookmark.pasteConfig;

    expect(config).not.toBe(false);
    const patterns = config === false ? undefined : config.patterns;

    expect(patterns).toBeDefined();
    const pattern = patterns?.bookmark;

    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern?.test('https://example.com/article')).toBe(true);
    expect(pattern?.test('not a url')).toBe(false);
  });

  it('renders an empty placeholder when constructed without a url', () => {
    const tool = new Bookmark(createOptions());

    const root = tool.render();

    expect(root.querySelector('[data-blok-testid="bookmark-empty"]')).not.toBeNull();
  });

  it('enters a loading state when a URL is pasted', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const tool = new Bookmark(createOptions());
    const root = tool.render();

    tool.onPaste(patternEvent('https://example.com/article'));

    expect(root.querySelector('[data-blok-testid="bookmark-loading"]')).not.toBeNull();
  });

  it('renders a card with fetched metadata after a successful paste', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        success: 1,
        link: 'https://example.com/article',
        meta: {
          title: 'Hello Title',
          description: 'Hello Description',
          image: { url: 'https://example.com/og.png' },
          favicon: 'https://example.com/favicon.ico',
          domain: 'example.com',
        },
      })
    );
    const tool = new Bookmark(createOptions());
    const root = tool.render();

    tool.onPaste(patternEvent('https://example.com/article'));
    await flush();

    const card = root.querySelector('[data-blok-testid="bookmark-card"]');

    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Hello Title');
    expect(card?.textContent).toContain('Hello Description');
  });

  it('renders an error state when the fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));
    const tool = new Bookmark(createOptions());
    const root = tool.render();

    tool.onPaste(patternEvent('https://example.com/article'));
    await flush();

    expect(root.querySelector('[data-blok-testid="bookmark-error"]')).not.toBeNull();
  });

  it('saves the stored metadata', () => {
    const tool = new Bookmark(
      createOptions({
        url: 'https://example.com/article',
        title: 'Hello Title',
        description: 'Hello Description',
        image: 'https://example.com/og.png',
        favicon: 'https://example.com/favicon.ico',
        domain: 'example.com',
      })
    );

    expect(tool.save()).toEqual({
      url: 'https://example.com/article',
      title: 'Hello Title',
      description: 'Hello Description',
      image: 'https://example.com/og.png',
      favicon: 'https://example.com/favicon.ico',
      domain: 'example.com',
    });
  });

  it('validates only when a url is present', () => {
    const tool = new Bookmark(createOptions());

    expect(tool.validate({ url: 'https://example.com' } as BookmarkData)).toBe(true);
    expect(tool.validate({ url: '' } as BookmarkData)).toBe(false);
  });

  it('renders a card directly when constructed with stored metadata', () => {
    const tool = new Bookmark(
      createOptions({ url: 'https://example.com/article', title: 'Stored' })
    );

    const root = tool.render();

    expect(root.querySelector('[data-blok-testid="bookmark-card"]')).not.toBeNull();
    expect(root.textContent).toContain('Stored');
  });
});
