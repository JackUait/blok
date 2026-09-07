import { describe, it, expect } from 'vitest';
import { normalizeListItemData } from '../../../../src/tools/list/data-normalizer';

/**
 * A collaborative document never deletes a top-level data key, so a once-migrated
 * list item keeps its legacy `items` array forever. Reading that array in
 * preference to `text` re-derives the item on every load and discards every edit
 * made since the migration.
 */
describe('list normalization with a stale legacy items key', () => {
  const settings = { defaultStyle: 'unordered' as const };

  it('keeps the edited text when a stale items array is still present', () => {
    const result = normalizeListItemData(
      { text: 'edited after migration', items: ['original'], style: 'unordered' },
      settings
    );

    expect(result.text).toBe('edited after migration');
  });

  it('keeps the structural depth a stale items array would reset to 0', () => {
    const result = normalizeListItemData(
      { text: 'nested item', items: ['original'], style: 'unordered', depth: 2 },
      settings
    );

    expect(result.depth).toBe(2);
  });

  // Deliberate trade-off: an EMPTY text cannot be told apart from the empty
  // default the tool injects beside legacy data, so an emptied item whose stale
  // `items` array has not been pruned yet re-reads that array once. Preferring
  // the other way round would normalize every legacy import to an empty item.
  it('still reads items[] when the text is empty, since that is the legacy default', () => {
    const result = normalizeListItemData(
      { text: '', items: ['original'], style: 'unordered' },
      settings
    );

    expect(result.text).toBe('original');
  });

  // The legacy branch still has to work for data that has never been through
  // save() — a host handing the tool an old document directly.
  it('still reads items[] when the item has no text key at all', () => {
    const result = normalizeListItemData(
      { items: ['original'], style: 'unordered' },
      settings
    );

    expect(result.text).toBe('original');
  });

  it('still reads the legacy {content} item shape when there is no text key', () => {
    const result = normalizeListItemData(
      { items: [{ content: 'from content', checked: true }], style: 'unordered' },
      settings
    );

    expect(result).toMatchObject({ text: 'from content', checked: true });
  });
});
