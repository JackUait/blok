import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeListItemData } from '../../../../src/tools/list/data-normalizer';
import type { ListItemConfig } from '../../../../src/tools/list/types';

// Every assertion here is toStrictEqual on the whole shape: for a normalizer an
// OMITTED key is behaviour, and `toEqual` cannot tell `{ start: undefined }`
// from a missing `start`.
const NO_SETTINGS: ListItemConfig = {};

describe('normalizeListItemData — mutation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('legacy items array vs saved text', () => {
    it('keeps the saved text and depth when a stale legacy items array is still present', () => {
      const result = normalizeListItemData(
        { text: 'Edited body', items: [{ content: 'stale legacy body' }], depth: 3 },
        NO_SETTINGS,
      );

      expect(result).toStrictEqual({
        text: 'Edited body',
        style: 'unordered',
        checked: false,
        depth: 3,
      });
    });

    it('reads authoritativeness from the text key only, so a non-empty style still takes the legacy branch', () => {
      const result = normalizeListItemData(
        { items: [{ content: 'Legacy checklist entry' }], style: 'checklist' },
        NO_SETTINGS,
      );

      expect(result).toStrictEqual({
        text: 'Legacy checklist entry',
        style: 'checklist',
        checked: false,
        depth: 0,
      });
    });

    it('refuses a non-string text as authoritative, so a null text still takes the legacy branch', () => {
      const legacyWithNullText: unknown = { items: [{ content: 'Delta body' }], text: null };

      const result = normalizeListItemData(legacyWithNullText, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Delta body',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('refuses a numeric text as authoritative too', () => {
      const legacyWithNumericText: unknown = { items: [{ content: 'Epsilon body' }], text: 7 };

      const result = normalizeListItemData(legacyWithNumericText, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Epsilon body',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });
  });

  describe('style resolution', () => {
    it('keeps an explicit unordered style when the config default is ordered', () => {
      const result = normalizeListItemData({ style: 'unordered' }, { defaultStyle: 'ordered' });

      expect(result).toStrictEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('falls back to the config default for an empty-string style', () => {
      const result = normalizeListItemData({ style: '' }, { defaultStyle: 'checklist' });

      expect(result).toStrictEqual({
        text: '',
        style: 'checklist',
        checked: false,
        depth: 0,
      });
    });

    it('falls back to the config default for an unrecognized style', () => {
      const result = normalizeListItemData({ style: 'bullet' }, { defaultStyle: 'ordered' });

      expect(result).toStrictEqual({
        text: '',
        style: 'ordered',
        checked: false,
        depth: 0,
      });
    });
  });

  describe('legacy entry extraction', () => {
    it('marks a plain string legacy entry as unchecked', () => {
      const result = normalizeListItemData({ items: ['Milk', 'Bread'] }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Milk',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('represents a null legacy entry as an empty unchecked item instead of throwing', () => {
      const legacyWithNullEntry: unknown = { items: [null] };

      const result = normalizeListItemData(legacyWithNullEntry, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('marks an unrecognized legacy entry type as unchecked', () => {
      const legacyWithNumberEntry: unknown = { items: [42] };

      const result = normalizeListItemData(legacyWithNumberEntry, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });
  });

  describe('legacy start handling', () => {
    it('omits start entirely for legacy data that carries none', () => {
      const result = normalizeListItemData({ items: [{ content: 'Legacy start' }] }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Legacy start',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('keeps a legacy start of 10', () => {
      const result = normalizeListItemData(
        { items: [{ content: 'Legacy start' }], start: 10 },
        NO_SETTINGS,
      );

      expect(result).toStrictEqual({
        text: 'Legacy start',
        style: 'unordered',
        checked: false,
        depth: 0,
        start: 10,
      });
    });

    it('omits a legacy start of exactly 1', () => {
      const result = normalizeListItemData(
        { items: [{ content: 'Legacy start' }], start: 1 },
        NO_SETTINGS,
      );

      expect(result).toStrictEqual({
        text: 'Legacy start',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });
  });

  describe('standard start handling', () => {
    it('omits the start key entirely for standard data that carries none', () => {
      const result = normalizeListItemData({ text: 'Plain item' }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Plain item',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('ignores a non-numeric start', () => {
      const result = normalizeListItemData({ text: 'Plain item', start: '5' }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Plain item',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('omits a numeric start of exactly 1', () => {
      const result = normalizeListItemData({ text: 'Plain item', start: 1 }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Plain item',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('keeps a numeric start other than 1', () => {
      const result = normalizeListItemData({ text: 'Plain item', start: 7 }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Plain item',
        style: 'unordered',
        checked: false,
        depth: 0,
        start: 7,
      });
    });

    it('keeps a start of 0', () => {
      const result = normalizeListItemData({ text: 'Plain item', start: 0 }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: 'Plain item',
        style: 'unordered',
        checked: false,
        depth: 0,
        start: 0,
      });
    });
  });

  describe('standard field coercion', () => {
    it('coerces text, checked and depth together', () => {
      const result = normalizeListItemData(
        { text: 'Alpha', style: 'checklist', checked: 1, depth: 2 },
        NO_SETTINGS,
      );

      expect(result).toStrictEqual({
        text: 'Alpha',
        style: 'checklist',
        checked: true,
        depth: 2,
      });
    });

    it('drops a non-string text to the empty string', () => {
      const result = normalizeListItemData({ text: 99, depth: -1 }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: -1,
      });
    });

    it('drops a non-number depth to 0', () => {
      const result = normalizeListItemData({ depth: '3' }, NO_SETTINGS);

      expect(result).toStrictEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });
  });

  describe('non-object input', () => {
    const nonObjectInputs: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'text'],
      ['a number', 12],
      ['a boolean', true],
    ];

    it.each(nonObjectInputs)('returns the default item for %s', (_label, input) => {
      const result = normalizeListItemData(input, { defaultStyle: 'checklist' });

      expect(result).toStrictEqual({
        text: '',
        style: 'checklist',
        checked: false,
        depth: 0,
      });
    });
  });
});
