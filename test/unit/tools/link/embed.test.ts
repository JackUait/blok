import { describe, it, expect, vi } from 'vitest';
import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import type { API, BlockToolConstructorOptions, PatternPasteEvent } from '../../../../types';

const createMockAPI = (blocksDelete?: (id: string) => void): API =>
  ({
    i18n: { t: (key: string) => key, has: () => false },
    blocks: { delete: blocksDelete ?? ((): void => undefined) },
  }) as unknown as API;

const createOptions = (
  data: Partial<EmbedData> = {},
  overrides: {
    readOnly?: boolean;
    dispatchChange?: () => void;
    blocksDelete?: (id: string) => void;
    blockId?: string;
  } = {}
): BlockToolConstructorOptions<EmbedData> =>
  ({
    api: createMockAPI(overrides.blocksDelete),
    block: {
      id: overrides.blockId ?? 'embed-block',
      dispatchChange: overrides.dispatchChange ?? ((): void => undefined),
    } as never,
    config: {},
    readOnly: overrides.readOnly ?? false,
    data: data as EmbedData,
  }) as BlockToolConstructorOptions<EmbedData>;

const iframeData = (overrides: Partial<EmbedData> = {}): Partial<EmbedData> => ({
  service: 'youtube',
  source: 'https://youtu.be/dQw4w9WgXcQ',
  embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  width: 580,
  height: 320,
  ...overrides,
});

function makeRect(width: number, left = 0): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 100,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

const patternEvent = (key: string, url: string): PatternPasteEvent =>
  ({ type: 'pattern', detail: { key, data: url } }) as PatternPasteEvent;

describe('Embed tool', () => {
  it('registers per-service paste patterns including Russian providers', () => {
    const config = Embed.pasteConfig;

    expect(config).not.toBe(false);
    const patterns = config === false ? undefined : config.patterns;

    expect(patterns?.youtube).toBeInstanceOf(RegExp);
    expect(patterns?.vimeo).toBeInstanceOf(RegExp);
    expect(patterns?.rutube).toBeInstanceOf(RegExp);
    expect(patterns?.vkvideo).toBeInstanceOf(RegExp);
  });

  it('resolves a pasted YouTube URL into embed data', () => {
    const tool = new Embed(createOptions());

    tool.onPaste(patternEvent('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'));

    expect(tool.save()).toMatchObject({
      service: 'youtube',
      source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    });
  });

  it('resolves a pasted VKVideo URL into embed data', () => {
    const tool = new Embed(createOptions());

    tool.onPaste(patternEvent('vkvideo', 'https://vk.com/video-12345_67890'));

    expect(tool.save()).toMatchObject({
      service: 'vkvideo',
      embed: 'https://vk.com/video_ext.php?oid=-12345&id=67890',
    });
  });

  it('renders a sandboxed iframe pointing at the resolved embed URL', () => {
    const tool = new Embed(
      createOptions({
        service: 'youtube',
        source: 'https://youtu.be/dQw4w9WgXcQ',
        embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      })
    );

    const root = tool.render();
    const iframe = root.querySelector('iframe');

    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('resolves a pasted Twitter/X URL as a script embed', () => {
    const tool = new Embed(createOptions());

    tool.onPaste(patternEvent('twitter', 'https://x.com/user/status/1234567890'));

    expect(tool.save()).toMatchObject({ service: 'twitter', kind: 'script' });
  });

  it('renders a widget script (not an iframe) for a script-kind embed like Telegram', () => {
    const tool = new Embed(
      createOptions({
        service: 'telegram',
        source: 'https://t.me/durov/123',
        embed: 'https://t.me/durov/123',
        kind: 'script',
      })
    );

    const root = tool.render();

    expect(root.querySelector('iframe')).toBeNull();
    const script = root.querySelector('script');

    expect(script).not.toBeNull();
    expect(script?.getAttribute('src')).toContain('telegram');
    expect(script?.getAttribute('data-telegram-post')).toBe('durov/123');
  });

  it('renders a blockquote + widgets.js script for a Twitter/X embed', () => {
    const tool = new Embed(
      createOptions({
        service: 'twitter',
        source: 'https://x.com/user/status/1234567890',
        embed: 'https://twitter.com/i/status/1234567890',
        kind: 'script',
      })
    );

    const root = tool.render();
    const script = root.querySelector('script');

    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('blockquote')).not.toBeNull();
    expect(script?.getAttribute('src')).toContain('twitter.com');
  });

  it('resolves a pasted Threads URL as a script embed', () => {
    const tool = new Embed(createOptions());

    tool.onPaste(patternEvent('threads', 'https://www.threads.com/@zuck/post/C8z2Qq0Rk1x'));

    expect(tool.save()).toMatchObject({
      service: 'threads',
      kind: 'script',
      embed: 'https://www.threads.com/@zuck/post/C8z2Qq0Rk1x',
    });
  });

  it('renders the official text-post blockquote + embed.js script for a Threads embed', () => {
    const tool = new Embed(
      createOptions({
        service: 'threads',
        source: 'https://www.threads.net/@zuck/post/C8z2Qq0Rk1x',
        embed: 'https://www.threads.com/@zuck/post/C8z2Qq0Rk1x',
        kind: 'script',
      })
    );

    const root = tool.render();
    const blockquote = root.querySelector('blockquote');
    const script = root.querySelector('script');

    expect(root.querySelector('iframe')).toBeNull();
    expect(blockquote?.className).toBe('text-post-media');
    expect(blockquote?.getAttribute('data-text-post-permalink')).toBe('https://www.threads.com/@zuck/post/C8z2Qq0Rk1x');
    expect(blockquote?.getAttribute('data-text-post-version')).toBe('0');
    expect(blockquote?.querySelector('a')?.getAttribute('href')).toBe('https://www.threads.com/@zuck/post/C8z2Qq0Rk1x');
    expect(script?.getAttribute('src')).toBe('https://www.threads.com/embed.js');
  });

  it('keeps the embed-script testid container for a Threads embed', () => {
    const tool = new Embed(
      createOptions({
        service: 'threads',
        source: 'https://www.threads.com/@zuck/post/C8z2Qq0Rk1x',
        embed: 'https://www.threads.com/@zuck/post/C8z2Qq0Rk1x',
        kind: 'script',
      })
    );

    const root = tool.render();

    expect(root.querySelector('[data-blok-testid="embed-script"]')).not.toBeNull();
    expect(root.querySelector('blockquote.twitter-tweet')).toBeNull();
  });

  it('validates only when source and embed are present', () => {
    const tool = new Embed(createOptions());

    expect(
      tool.validate({ service: 'youtube', source: 'a', embed: 'b' } as EmbedData)
    ).toBe(true);
    expect(tool.validate({ service: 'youtube', source: '', embed: '' } as EmbedData)).toBe(false);
  });
});

describe('Embed sizing & resize', () => {
  const figureOf = (root: HTMLElement): HTMLElement | null =>
    root.querySelector('[data-role="embed-figure"]');

  it('stretches an iframe embed to full container width by default', () => {
    const tool = new Embed(createOptions(iframeData()));

    const figure = figureOf(tool.render());

    expect(figure).not.toBeNull();
    expect(figure?.style.width).toBe('100%');
  });

  it('renders the saved widthPercent on the figure', () => {
    const tool = new Embed(createOptions(iframeData({ widthPercent: 50 })));

    expect(figureOf(tool.render())?.style.width).toBe('50%');
  });

  it('caps the figure at the provider natural width for fixed-content services (tiktok)', () => {
    const tool = new Embed(
      createOptions({
        service: 'tiktok',
        source: 'https://www.tiktok.com/@user/video/7469789434322455863',
        embed: 'https://www.tiktok.com/embed/v2/7469789434322455863',
        width: 325,
        height: 580,
      })
    );

    const figure = figureOf(tool.render());

    expect(figure?.style.maxWidth).toBe('325px');
  });

  it('keeps fluid max-width for services whose content scales with the iframe', () => {
    const tool = new Embed(createOptions(iframeData()));

    expect(figureOf(tool.render())?.style.maxWidth).toBe('100%');
  });

  it('keeps the provider aspect ratio on the iframe box', () => {
    const tool = new Embed(createOptions(iframeData({ width: 580, height: 320 })));

    const box = tool.render().querySelector<HTMLElement>('[data-role="embed-aspect"]');

    expect(box?.style.aspectRatio).toBe('580 / 320');
  });

  it('adds left and right resize handles for an iframe embed', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();

    const handles = root.querySelectorAll('[data-role="resize-handle"]');

    expect(handles.length).toBe(2);
    expect(root.querySelector('[data-role="resize-handle"][data-edge="left"]')).not.toBeNull();
    expect(root.querySelector('[data-role="resize-handle"][data-edge="right"]')).not.toBeNull();
  });

  it('omits resize handles in read-only mode', () => {
    const tool = new Embed(createOptions(iframeData(), { readOnly: true }));

    expect(tool.render().querySelectorAll('[data-role="resize-handle"]').length).toBe(0);
  });

  it('does not add resize handles to a script embed', () => {
    const tool = new Embed(
      createOptions({
        service: 'telegram',
        source: 'https://t.me/durov/123',
        embed: 'https://t.me/durov/123',
        kind: 'script',
      })
    );

    expect(tool.render().querySelectorAll('[data-role="resize-handle"]').length).toBe(0);
  });

  it('persists a new width and notifies the block when a handle is dragged', () => {
    const dispatchChange = vi.fn();
    const tool = new Embed(createOptions(iframeData(), { dispatchChange }));
    const root = tool.render();
    const figure = figureOf(root);

    if (!figure) {
      throw new Error('figure missing');
    }

    Object.defineProperty(root, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });
    Object.defineProperty(figure, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });

    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');

    if (!handle) {
      throw new Error('handle missing');
    }
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;

    // Center-anchored right handle: a -200px pointer move shrinks width by 2× → 60%.
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 800, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 800, bubbles: true }));

    expect(figure.style.width).toBe('60%');
    expect(dispatchChange).toHaveBeenCalled();
    expect(tool.save().widthPercent).toBe(60);
  });

  it('clamps resize to the per-service minimum width instead of the global floor', () => {
    const dispatchChange = vi.fn();
    // YouTube's registry minWidth is 200px → 20% of a 1000px container.
    const tool = new Embed(createOptions(iframeData(), { dispatchChange }));
    const root = tool.render();
    const figure = figureOf(root);

    if (!figure) {
      throw new Error('figure missing');
    }

    Object.defineProperty(root, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });
    Object.defineProperty(figure, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });

    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');

    if (!handle) {
      throw new Error('handle missing');
    }
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;

    // Drag the right edge hard left; uncapped this collapses well below 20%.
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 0, bubbles: true }));

    expect(tool.save().widthPercent).toBe(20);
  });
});

describe('Embed block toolbar anchoring', () => {
  it('getToolbarAnchorElement() returns the embed figure so the block toolbar centers at the embed top, not on the caption', () => {
    const tool = new Embed(createOptions(iframeData({ captionVisible: true })));
    const root = tool.render();
    const figure = root.querySelector('[data-role="embed-figure"]');

    expect(figure).not.toBeNull();
    expect(tool.getToolbarAnchorElement()).toBe(figure);
  });

  it('getToolbarAnchorElement() returns undefined when there is no figure (empty / script states)', () => {
    const empty = new Embed(createOptions());

    empty.render();
    expect(empty.getToolbarAnchorElement()).toBeUndefined();

    const script = new Embed(
      createOptions({ service: 'telegram', source: 'https://t.me/d/1', embed: 'https://t.me/d/1', kind: 'script' })
    );

    script.render();
    expect(script.getToolbarAnchorElement()).toBeUndefined();
  });

  it('getContentOffset() returns the horizontal offset of the figure relative to the tool root so + / ⋮⋮ align with the embed left edge', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    if (!figure) {
      throw new Error('figure missing');
    }
    Object.defineProperty(root, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });
    Object.defineProperty(figure, 'getBoundingClientRect', { value: () => makeRect(325, 120) });

    expect(tool.getContentOffset(figure)).toEqual({ left: 120 });
  });

  it('getContentOffset() returns undefined when the figure fills the content area', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();
    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    if (!figure) {
      throw new Error('figure missing');
    }
    Object.defineProperty(root, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });
    Object.defineProperty(figure, 'getBoundingClientRect', { value: () => makeRect(1000, 0) });

    expect(tool.getContentOffset(figure)).toBeUndefined();
  });

  it('getContentOffset() returns undefined when there is no figure (empty state)', () => {
    const tool = new Embed(createOptions());

    tool.render();
    expect(tool.getContentOffset(document.createElement('div'))).toBeUndefined();
  });
});

describe('Embed toolbar integration', () => {
  const click = (el: Element | null): void => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  it('renders the hover toolbar for an editable iframe embed', () => {
    const tool = new Embed(createOptions(iframeData()));

    expect(tool.render().querySelector('[data-role="embed-overlay"]')).not.toBeNull();
  });

  it('omits the toolbar in read-only mode', () => {
    const tool = new Embed(createOptions(iframeData(), { readOnly: true }));

    expect(tool.render().querySelector('[data-role="embed-overlay"]')).toBeNull();
  });

  it('omits the toolbar for a script embed', () => {
    const tool = new Embed(
      createOptions({ service: 'telegram', source: 'https://t.me/d/1', embed: 'https://t.me/d/1', kind: 'script' })
    );

    expect(tool.render().querySelector('[data-role="embed-overlay"]')).toBeNull();
  });

  it('toggles a caption field and persists captionVisible', () => {
    const dispatchChange = vi.fn();
    const tool = new Embed(createOptions(iframeData(), { dispatchChange }));
    const root = tool.render();

    expect(root.querySelector('[data-role="embed-caption"]')).toBeNull();

    click(root.querySelector('[data-action="caption-toggle"]'));

    expect(root.querySelector('[data-role="embed-caption"]')).not.toBeNull();
    expect(dispatchChange).toHaveBeenCalled();
    expect(tool.save().captionVisible).toBe(true);
  });

  it('hides the caption when toggled off even though it still has text', () => {
    const tool = new Embed(createOptions(iframeData({ caption: 'My clip', captionVisible: true })));
    const root = tool.render();

    expect(root.querySelector('[data-role="embed-caption"]')).not.toBeNull();

    click(root.querySelector('[data-action="caption-toggle"]'));

    // Toggling off must hide the caption; the text is kept in data for re-toggling.
    expect(root.querySelector('[data-role="embed-caption"]')).toBeNull();
    expect(tool.save().captionVisible).toBe(false);
    expect(tool.save().caption).toBe('My clip');
  });

  it('preserves the live iframe element across a caption toggle (no reload blink)', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();
    const before = root.querySelector('iframe');

    click(root.querySelector('[data-action="caption-toggle"]'));
    const afterOn = root.querySelector('iframe');

    click(root.querySelector('[data-action="caption-toggle"]'));
    const afterOff = root.querySelector('iframe');

    expect(before).not.toBeNull();
    // Same node instance ⇒ the frame was never detached/recreated, so it never reloads.
    expect(afterOn).toBe(before);
    expect(afterOff).toBe(before);
  });

  it('keeps exactly two resize handles after a caption toggle', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();

    click(root.querySelector('[data-action="caption-toggle"]'));
    click(root.querySelector('[data-action="caption-toggle"]'));

    expect(root.querySelectorAll('[data-role="resize-handle"]').length).toBe(2);
  });

  it('shows a caption with text when captionVisible is unset (legacy data)', () => {
    const tool = new Embed(createOptions(iframeData({ caption: 'Legacy' })));
    const root = tool.render();

    expect(root.querySelector('[data-role="embed-caption"]')?.textContent).toBe('Legacy');
  });

  it('saves edited caption text', () => {
    const tool = new Embed(createOptions(iframeData({ captionVisible: true })));
    const root = tool.render();
    const caption = root.querySelector<HTMLElement>('[data-role="embed-caption"]');

    if (!caption) {
      throw new Error('caption missing');
    }
    caption.textContent = 'My clip';
    caption.dispatchEvent(new FocusEvent('blur'));

    expect(tool.save().caption).toBe('My clip');
  });

  it('applies a chosen alignment to the figure and persists it', () => {
    const dispatchChange = vi.fn();
    const tool = new Embed(createOptions(iframeData(), { dispatchChange }));
    const root = tool.render();

    click(root.querySelector('[data-action="align-trigger"]'));
    click(root.querySelector('[data-action="align-right"]'));

    const figure = root.querySelector<HTMLElement>('[data-role="embed-figure"]');

    expect(figure?.style.marginLeft).toBe('auto');
    expect(figure?.style.marginRight).toBe('0px');
    expect(dispatchChange).toHaveBeenCalled();
    expect(tool.save().alignment).toBe('right');
  });

  it('preserves the live iframe element across an alignment change (no reload blink)', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();
    const before = root.querySelector('iframe');

    click(root.querySelector('[data-action="align-trigger"]'));
    click(root.querySelector('[data-action="align-right"]'));

    const after = root.querySelector('iframe');

    expect(before).not.toBeNull();
    // Same node instance ⇒ the frame was never detached/recreated, so it never reloads.
    expect(after).toBe(before);
  });

  it('keeps exactly two resize handles after an alignment change', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();

    click(root.querySelector('[data-action="align-trigger"]'));
    click(root.querySelector('[data-action="align-left"]'));

    expect(root.querySelectorAll('[data-role="resize-handle"]').length).toBe(2);
  });

  it('updates the overlay active alignment in place after a change', () => {
    const tool = new Embed(createOptions(iframeData()));
    const root = tool.render();

    click(root.querySelector('[data-action="align-trigger"]'));
    click(root.querySelector('[data-action="align-right"]'));

    expect(root.querySelector('[data-action="align-trigger"]')?.getAttribute('data-current')).toBe('right');
  });

  it('deletes the block through the more menu', () => {
    const del = vi.fn();
    const tool = new Embed(createOptions(iframeData(), { blocksDelete: del, blockId: 'embed-1' }));
    const root = tool.render();

    click(root.querySelector('[data-action="more"]'));
    click(root.querySelector('[data-action="delete"]'));

    expect(del).toHaveBeenCalledWith('embed-1');
  });

  describe('setReadOnly (in-place read-only toggle)', () => {
    it('removes resize handles and overlay when entering read-only', () => {
      const tool = new Embed(createOptions(iframeData()));
      const root = tool.render();

      expect(root.querySelectorAll('[data-role="resize-handle"]').length).toBe(2);
      expect(root.querySelector('[data-role="embed-overlay"]')).not.toBeNull();

      tool.setReadOnly(true);

      expect(root.querySelectorAll('[data-role="resize-handle"]').length).toBe(0);
      expect(root.querySelector('[data-role="embed-overlay"]')).toBeNull();
    });

    it('restores resize handles and overlay when exiting read-only', () => {
      const tool = new Embed(createOptions(iframeData(), { readOnly: true }));
      const root = tool.render();

      tool.setReadOnly(false);

      expect(root.querySelectorAll('[data-role="resize-handle"]').length).toBe(2);
      expect(root.querySelector('[data-role="embed-overlay"]')).not.toBeNull();
    });

    it('toggles caption contenteditable and preserves uncommitted caption edits', () => {
      const tool = new Embed(createOptions(iframeData({ captionVisible: true })));
      const root = tool.render();
      const caption = root.querySelector<HTMLElement>('[data-role="embed-caption"]');

      if (!caption) {
        throw new Error('caption missing');
      }

      // Live edit that has NOT been committed via blur yet
      caption.textContent = 'Edited live';

      tool.setReadOnly(true);

      const readOnlyCaption = root.querySelector<HTMLElement>('[data-role="embed-caption"]');

      expect(readOnlyCaption?.getAttribute('contenteditable')).toBe('false');
      expect(readOnlyCaption?.textContent).toBe('Edited live');

      tool.setReadOnly(false);

      const editableCaption = root.querySelector<HTMLElement>('[data-role="embed-caption"]');

      expect(editableCaption?.getAttribute('contenteditable')).toBe('true');
      expect(tool.save().caption).toBe('Edited live');
    });
  });
});
