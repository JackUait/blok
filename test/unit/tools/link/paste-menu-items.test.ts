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
): { name?: string; title?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void } =>
  item as { name?: string; title?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void };

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
});
