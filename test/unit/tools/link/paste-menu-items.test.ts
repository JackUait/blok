import { describe, it, expect, vi } from 'vitest';
import { buildPasteMenuItems, type PasteMenuI18n } from '../../../../src/tools/link/paste-menu/items';
import type { PasteMenuOption } from '../../../../src/tools/link/paste-menu/options';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';

const identityI18n: PasteMenuI18n = { t: (key: string): string => key };

/**
 * Narrows a popover item to a default-base item exposing the fields we assert on.
 * Items built here are always default items with an onActivate handler.
 */
const asDefaultItem = (
  item: PopoverItemParams
): { name?: string; title?: string; secondaryLabel?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void } =>
  item as { name?: string; title?: string; secondaryLabel?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void };

describe('buildPasteMenuItems', () => {
  it('builds one item per option, preserving order', () => {
    const options: PasteMenuOption[] = [
      { type: 'embed' },
      { type: 'bookmark' },
      { type: 'mention' },
      { type: 'plain' },
    ];

    const names = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).name
    );

    expect(names).toEqual([
      'paste-menu-embed',
      'paste-menu-bookmark',
      'paste-menu-mention',
      'paste-menu-plain',
    ]);
  });

  it('sets the title to the i18n label key for each type', () => {
    const options: PasteMenuOption[] = [
      { type: 'plain' },
      { type: 'bookmark' },
      { type: 'embed' },
      { type: 'mention' },
    ];

    const titles = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).title
    );

    expect(titles).toEqual([
      'tools.linkPaste.plain',
      'tools.linkPaste.bookmark',
      'tools.linkPaste.embed',
      'tools.linkPaste.mention',
    ]);
  });

  it('gives the bookmark option a distinct icon from the plain link option', () => {
    const options: PasteMenuOption[] = [{ type: 'plain' }, { type: 'bookmark' }];

    const [plain, bookmark] = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).icon
    );

    expect(plain).not.toBe(bookmark);
  });

  it('sets name, closeOnActivate and a non-empty icon for each item', () => {
    const options: PasteMenuOption[] = [
      { type: 'embed' },
      { type: 'bookmark' },
      { type: 'mention' },
      { type: 'plain' },
    ];

    const items = buildPasteMenuItems(options, identityI18n, vi.fn());

    items.forEach((rawItem, index) => {
      const item = asDefaultItem(rawItem);

      expect(item.name).toBe(`paste-menu-${options[index].type}`);
      expect(item.closeOnActivate).toBe(true);
      expect(typeof item.icon).toBe('string');
      expect(item.icon).not.toBe('');
    });
  });

  it('calls onSelect with the item action type on activation', () => {
    const onSelect = vi.fn();
    const options: PasteMenuOption[] = [
      { type: 'bookmark' },
      { type: 'embed' },
    ];

    const items = buildPasteMenuItems(options, identityI18n, onSelect);

    asDefaultItem(items[0]).onActivate?.({});
    expect(onSelect).toHaveBeenCalledWith('bookmark');

    asDefaultItem(items[1]).onActivate?.({});
    expect(onSelect).toHaveBeenCalledWith('embed');

    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  describe('embed item presentation for a recognized provider url', () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    it('shows the provider name as title and the embed action as secondary label', () => {
      const items = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn(), youtubeUrl);
      const embed = asDefaultItem(items[0]);

      expect(embed.title).toBe('YouTube');
      expect(embed.secondaryLabel).toBe('tools.linkPaste.embed');
    });

    it('uses a link-type icon distinct from the generic embed globe', () => {
      const [withUrl] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn(), youtubeUrl);
      const [generic] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn());

      expect(asDefaultItem(withUrl).icon).not.toBe(asDefaultItem(generic).icon);
      expect(asDefaultItem(withUrl).icon).toContain('<svg');
    });

    it('gives different link types different icons', () => {
      const [video] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn(), youtubeUrl);
      const [audio] = buildPasteMenuItems(
        [{ type: 'embed' }],
        identityI18n,
        vi.fn(),
        'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
      );

      expect(asDefaultItem(video).icon).not.toBe(asDefaultItem(audio).icon);
    });

    it('leaves bookmark and plain items unchanged by the url', () => {
      const withUrl = buildPasteMenuItems(
        [{ type: 'bookmark' }, { type: 'plain' }],
        identityI18n,
        vi.fn(),
        youtubeUrl
      );
      const generic = buildPasteMenuItems([{ type: 'bookmark' }, { type: 'plain' }], identityI18n, vi.fn());

      withUrl.forEach((item, index) => {
        expect(asDefaultItem(item).title).toBe(asDefaultItem(generic[index]).title);
        expect(asDefaultItem(item).icon).toBe(asDefaultItem(generic[index]).icon);
        expect(asDefaultItem(item).secondaryLabel).toBeUndefined();
      });
    });

    it('falls back to the generic embed presentation for an unrecognized url', () => {
      const [item] = buildPasteMenuItems(
        [{ type: 'embed' }],
        identityI18n,
        vi.fn(),
        'https://example.com/article'
      );
      const [generic] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn());

      expect(asDefaultItem(item).title).toBe(asDefaultItem(generic).title);
      expect(asDefaultItem(item).icon).toBe(asDefaultItem(generic).icon);
    });
  });
});
