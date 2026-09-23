import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConvertMenuItems,
  type ConvertMenuEntry,
  type ConvertMenuI18n,
} from '../../../../src/components/utils/convert-menu';
import { PopoverItemType } from '../../../../types/utils/popover/popover-item-type';

const i18n: ConvertMenuI18n = {
  t: key => key,
  has: () => true,
  getEnglishTranslation: key => key,
};

describe.each(['heading', 'toggle-heading'] as const)('%s number-strip metadata', (group) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<{ description: string; data: ConvertMenuEntry['data'] }>([
    { description: 'missing data', data: undefined },
    { description: 'missing level', data: {} },
    { description: 'undefined level', data: { level: undefined } },
    { description: 'null level', data: { level: null } },
    { description: 'string level', data: { level: '2' } },
  ])('keeps the icon fallback and conversion payload for $description', async ({ data }) => {
    const entry: ConvertMenuEntry = {
      group,
      icon: '<svg><path d="M0 0h10"/></svg>',
      title: 'Custom heading',
      englishTitle: 'Custom heading',
      searchTerms: ['custom'],
      name: 'custom-heading',
      toolName: 'custom',
      data,
    };
    const activatedEntries: ConvertMenuEntry[] = [];
    const items = buildConvertMenuItems([entry], i18n, activated => {
      activatedEntries.push(activated);
    });
    const choice = items[1];

    if (choice === undefined || (choice.type !== undefined && choice.type !== PopoverItemType.Default)) {
      throw new Error('Missing native heading choice');
    }

    expect(choice.dataset?.['blok-convert-level']).toBe('');
    expect(choice).toMatchObject({
      icon: '<svg><path d="M0 0h10"/></svg>',
      title: 'Custom heading',
      englishTitle: 'Custom heading',
      searchTerms: ['custom'],
      dataset: { 'blok-convert-group': group },
      closeOnActivate: true,
    });

    await choice.onActivate?.(choice);

    expect(activatedEntries).toHaveLength(1);
    expect(activatedEntries[0]).toBe(entry);
  });

  it.each([
    { level: 1, numeral: '1' },
    { level: 2, numeral: '2' },
    { level: 3, numeral: '3' },
    { level: 4, numeral: '4' },
    { level: 5, numeral: '5' },
    { level: 6, numeral: '6' },
    { level: 0, numeral: '0' },
    { level: 7, numeral: '7' },
    { level: 1.5, numeral: '1.5' },
    { level: NaN, numeral: 'NaN' },
    { level: Infinity, numeral: 'Infinity' },
  ])('exposes level $level for the numeral display', ({ level, numeral }) => {
    const items = buildConvertMenuItems([{
      group,
      icon: '<svg></svg>',
      title: 'Heading',
      name: 'heading',
      toolName: 'header',
      data: { level },
    }], i18n, () => undefined);
    const choice = items[1];

    if (choice === undefined || (choice.type !== undefined && choice.type !== PopoverItemType.Default)) {
      throw new Error('Missing native heading choice');
    }

    expect(choice.dataset?.['blok-convert-level']).toBe(numeral);
  });
});

describe.each(['heading', 'toggle-heading'] as const)('%s tile preview', (group) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildTitleEl = (data: ConvertMenuEntry['data']): HTMLElement | undefined => {
    const choice = buildConvertMenuItems([{
      group,
      icon: '<svg></svg>',
      title: 'Full title',
      name: 'heading',
      toolName: 'header',
      data,
    }], i18n, () => undefined)[1];

    if (choice === undefined || (choice.type !== undefined && choice.type !== PopoverItemType.Default)) {
      throw new Error('Missing native heading choice');
    }

    return choice.titleEl;
  };

  it.each([1, 2, 3, 4, 5, 6])('shows H%i in the tile and keeps the full title for search and names', (level) => {
    const titleEl = buildTitleEl({ level });

    expect(titleEl?.querySelector('[data-blok-convert-preview]')?.textContent).toBe(`H${level}`);
    expect(titleEl?.querySelector('[data-blok-convert-preview]')?.getAttribute('aria-hidden')).toBe('true');
    expect(titleEl?.querySelector('[data-blok-convert-full-title]')?.textContent).toBe('Full title');
    expect(titleEl?.getAttribute('aria-label')).toBe('Full title');
  });

  it('keeps the plain title when the level is missing', () => {
    expect(buildTitleEl(undefined)).toBeUndefined();
  });
});
