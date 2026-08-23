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
  config: BookmarkConfig = { endpoint: 'https://api.test/unfurl' },
  readOnly = false
): BlockToolConstructorOptions<BookmarkData, BookmarkConfig> =>
  ({
    api: createMockAPI(),
    block: {} as never,
    config,
    readOnly,
    data: data as BookmarkData,
  });

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

    expect(tool.validate({ url: 'https://example.com' })).toBe(true);
    expect(tool.validate({ url: '' })).toBe(false);
  });

  it('renders a card directly when constructed with stored metadata', () => {
    const tool = new Bookmark(
      createOptions({ url: 'https://example.com/article', title: 'Stored' })
    );

    const root = tool.render();

    expect(root.querySelector('[data-blok-testid="bookmark-card"]')).not.toBeNull();
    expect(root.textContent).toContain('Stored');
  });

  it('sets the card href for a valid https url', () => {
    const tool = new Bookmark(
      createOptions({ url: 'https://example.com/article', title: 'Stored' })
    );

    const root = tool.render();
    const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

    expect(card).not.toBeNull();
    expect(card?.getAttribute('href')).toBe('https://example.com/article');
  });

  it('does not set a javascript: href on the card (XSS guard)', () => {
    const tool = new Bookmark(
      createOptions({ url: 'javascript:alert(1)', title: 'Stored' })
    );

    const root = tool.render();
    const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

    expect(card).not.toBeNull();
    expect(card?.getAttribute('href')).toBeNull();
    expect(card?.href ?? '').not.toContain('javascript:');
  });

  describe('card DOM structure (Notion parity)', () => {
    const fullMeta: Partial<BookmarkData> = {
      url: 'https://example.com/article',
      title: 'Hello Title',
      description: 'Hello Description',
      image: 'https://example.com/og.png',
      favicon: 'https://example.com/favicon.ico',
      domain: 'example.com',
    };

    const renderCard = (data: Partial<BookmarkData>): HTMLAnchorElement => {
      const tool = new Bookmark(createOptions(data));
      const root = tool.render();
      const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

      if (card === null) {
        throw new Error('bookmark card was not rendered');
      }

      return card;
    };

    it('renders the blok-bookmark card with a content column holding title, description and link row in order', () => {
      const card = renderCard(fullMeta);

      expect(card.classList.contains('blok-bookmark')).toBe(true);

      const content = card.querySelector('[data-role="bookmark-content"]');

      expect(content).not.toBeNull();
      expect(content?.classList.contains('blok-bookmark__content')).toBe(true);

      const roles = Array.from(content?.children ?? []).map((child) =>
        child.getAttribute('data-role')
      );

      expect(roles).toEqual(['bookmark-title', 'bookmark-description', 'bookmark-link-row']);
    });

    it('places the favicon inside the link row and shows the full url text', () => {
      const card = renderCard(fullMeta);

      const linkRow = card.querySelector('[data-role="bookmark-link-row"]');

      expect(linkRow).not.toBeNull();

      const favicon = linkRow?.querySelector<HTMLImageElement>('img[data-role="bookmark-favicon"]');

      expect(favicon).not.toBeNull();
      expect(favicon?.classList.contains('blok-bookmark__favicon')).toBe(true);
      expect(favicon?.getAttribute('alt')).toBe('');

      const urlSpan = linkRow?.querySelector('[data-role="bookmark-url"]');

      expect(urlSpan).not.toBeNull();
      expect(urlSpan?.tagName).toBe('SPAN');
      expect(urlSpan?.classList.contains('blok-bookmark__url')).toBe(true);
      expect(urlSpan?.textContent).toBe('https://example.com/article');
    });

    it('renders the cover image in its own container outside the content column', () => {
      const card = renderCard(fullMeta);

      const imageContainer = card.querySelector('[data-role="bookmark-image"]');

      expect(imageContainer).not.toBeNull();
      expect(imageContainer?.classList.contains('blok-bookmark__image')).toBe(true);
      expect(imageContainer?.closest('[data-role="bookmark-content"]')).toBeNull();

      const img = imageContainer?.querySelector('img');

      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('https://example.com/og.png');
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('falls back to the hostname when metadata has no title', () => {
      const card = renderCard({ url: 'https://example.com/article' });

      const title = card.querySelector('[data-role="bookmark-title"]');

      expect(title?.textContent).toBe('example.com');
    });

    it('falls back to the raw url string when the url cannot be parsed', () => {
      const card = renderCard({ url: 'not-a-url' });

      const title = card.querySelector('[data-role="bookmark-title"]');

      expect(title?.textContent).toBe('not-a-url');
    });

    it('omits description, favicon and image elements when metadata lacks them', () => {
      const card = renderCard({ url: 'https://example.com/article', title: 'Hello Title' });

      expect(card.querySelector('[data-role="bookmark-description"]')).toBeNull();
      expect(card.querySelector('[data-role="bookmark-favicon"]')).toBeNull();
      expect(card.querySelector('[data-role="bookmark-image"]')).toBeNull();

      const urlSpan = card.querySelector('[data-role="bookmark-link-row"] [data-role="bookmark-url"]');

      expect(urlSpan?.textContent).toBe('https://example.com/article');
    });
  });

  describe('placeholder states share the styled placeholder class', () => {
    it('marks the empty state with blok-bookmark__placeholder', () => {
      const tool = new Bookmark(createOptions());
      const root = tool.render();

      const empty = root.querySelector('[data-blok-testid="bookmark-empty"]');

      expect(empty?.classList.contains('blok-bookmark__placeholder')).toBe(true);
    });

    it('marks the loading state with blok-bookmark__placeholder', () => {
      vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
      const tool = new Bookmark(createOptions());
      const root = tool.render();

      tool.onPaste(patternEvent('https://example.com/article'));

      const loading = root.querySelector('[data-blok-testid="bookmark-loading"]');

      expect(loading?.classList.contains('blok-bookmark__placeholder')).toBe(true);
    });
  });

  describe('a failed preview degrades to a plain link', () => {
    const URL = 'https://example.com/article';

    const renderAfterFailedFetch = async (): Promise<HTMLElement> => {
      const tool = new Bookmark(createOptions());
      const root = tool.render();

      tool.onPaste(patternEvent(URL));
      await flush();

      return root;
    };

    it('persists nothing but the url, so a reload cannot tell the failure happened', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));

      const tool = new Bookmark(createOptions());

      tool.render();
      tool.onPaste(patternEvent(URL));
      await flush();

      expect(tool.save()).toEqual({ url: URL });
    });

    it('renders a clickable card pointing at the pasted url when the unfurl reports no preview data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));

      const root = await renderAfterFailedFetch();
      const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

      expect(card).not.toBeNull();
      expect(card?.tagName).toBe('A');
      expect(card?.getAttribute('href')).toBe(URL);
      expect(card?.querySelector('[data-role="bookmark-title"]')?.textContent).toBe('example.com');
      expect(root.querySelector('[data-blok-testid="bookmark-error"]')).toBeNull();
    });

    it('renders the same card when the request itself rejects', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

      const root = await renderAfterFailedFetch();
      const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

      expect(card?.getAttribute('href')).toBe(URL);
      expect(root.querySelector('[data-blok-testid="bookmark-error"]')).toBeNull();
    });

    it('renders exactly what a reload of the saved block renders', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));

      const afterFailedPaste = await renderAfterFailedFetch();
      const afterReload = new Bookmark(createOptions({ url: URL })).render();

      expect(afterFailedPaste.innerHTML).toBe(afterReload.innerHTML);
    });

    it('keeps the link clickable in read-only mode', () => {
      const readOnlyRoot = new Bookmark(
        createOptions({ url: URL }, { endpoint: 'https://api.test/unfurl' }, true)
      ).render();

      const card = readOnlyRoot.querySelector<HTMLAnchorElement>(
        '[data-blok-testid="bookmark-card"]'
      );

      expect(card?.getAttribute('href')).toBe(URL);
    });

    it('keeps the link clickable when read-only is toggled in place after the failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));

      const tool = new Bookmark(createOptions());
      const root = tool.render();

      tool.onPaste(patternEvent(URL));
      await flush();
      tool.setReadOnly(true);

      const card = root.querySelector<HTMLAnchorElement>('[data-blok-testid="bookmark-card"]');

      expect(card?.getAttribute('href')).toBe(URL);
    });
  });

  describe('setReadOnly (in-place read-only toggle)', () => {
    it('has setReadOnly method that does not throw', () => {
      const tool = new Bookmark(createOptions({ url: 'https://example.com' }));

      tool.render();

      expect(() => tool.setReadOnly(true)).not.toThrow();
      expect(() => tool.setReadOnly(false)).not.toThrow();
    });
  });
});
