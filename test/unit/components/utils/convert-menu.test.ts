import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConvertMenuEntries, buildConvertMenuItems, type ConvertMenuEntry, type ConvertMenuI18n } from '../../../../src/components/utils/convert-menu';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import { CURRENT_CONVERT_VARIANT } from '../../../../src/components/utils/blocks';
import { IconCheck } from '../../../../src/components/icons';
import { PopoverDesktop } from '../../../../src/components/utils/popover/popover-desktop';
import { PopoverItemType } from '../../../../types/utils/popover/popover-item-type';
import type { MenuConfigItemDefaultParams } from '../../../../types/tools';

/**
 * i18n stub: t() echoes a "translated:<key>" string, has() is always true,
 * getEnglishTranslation() echoes "en:<key>". This lets assertions check that
 * the correct key was resolved without depending on real dictionaries.
 */
const createI18n = (): ConvertMenuI18n => ({
  t: (key: string) => `translated:${key}`,
  has: () => true,
  getEnglishTranslation: (key: string) => `en:${key}`,
});

/**
 * Build a BlockToolAdapter stub with a name and toolbox entries.
 */
const createToolStub = (
  name: string,
  toolbox: BlockToolAdapter['toolbox'],
): BlockToolAdapter => ({
  name,
  toolbox,
} as unknown as BlockToolAdapter);

describe('buildConvertMenuEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a titleKey-only toolbox entry to a non-empty title (the inline-menu bug)', () => {
    const quote = createToolStub('quote', [
      { icon: '<svg>q</svg>', titleKey: 'quote' },
    ]);

    const [entry] = buildConvertMenuEntries([quote], createI18n());

    expect(entry.title).toBe('translated:toolNames.quote');
    expect(entry.toolName).toBe('quote');
    expect(entry.name).toBe('quote');
  });

  it('produces one entry per toolbox item across multiple tools', () => {
    const tools = [
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text' }]),
      createToolStub('list', [
        { icon: '<svg>ul</svg>', titleKey: 'bulletedList', name: 'bulleted-list', data: { style: 'unordered' } },
        { icon: '<svg>ol</svg>', titleKey: 'numberedList', name: 'numbered-list', data: { style: 'ordered' } },
      ]),
    ];

    const entries = buildConvertMenuEntries(tools, createI18n());

    expect(entries.map((e) => e.name)).toEqual(['paragraph', 'bulleted-list', 'numbered-list']);
    expect(entries[1].data).toEqual({ style: 'unordered' });
    expect(entries[2].toolName).toBe('list');
  });

  it('uses a raw title when present (header variants)', () => {
    const header = createToolStub('header', [
      { icon: '<svg>h1</svg>', title: 'Heading 1', titleKey: 'heading1', data: { level: 1 } },
    ]);

    const [entry] = buildConvertMenuEntries([header], createI18n());

    // translateToolTitle prefers titleKey, but a raw title guarantees non-undefined.
    expect(entry.title).not.toBe('');
    expect(entry.englishTitle).toBe('en:toolNames.heading1');
  });

  it('skips entries without an icon', () => {
    const broken = createToolStub('broken', [
      { titleKey: 'text' },
      { icon: '<svg>ok</svg>', titleKey: 'quote' },
    ]);

    const entries = buildConvertMenuEntries([broken], createI18n());

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('translated:toolNames.quote');
  });

  it('orders entries by toolbox section like the slash menu, keeping toolbox order inside a section', () => {
    const tools = [
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text', section: 'basic' }]),
      createToolStub('header', [
        { icon: '<svg>h2</svg>', titleKey: 'tools.header.heading2', name: 'header-2', data: { level: 2 }, section: 'basic' },
        { icon: '<svg>t1</svg>', titleKey: 'tools.header.toggleHeading1', name: 'toggle-header-1', data: { level: 1, isToggleable: true }, section: 'advanced' },
      ]),
      createToolStub('custom', [{ icon: '<svg>c</svg>', title: 'Custom' }]),
      createToolStub('code', [{ icon: '<svg>code</svg>', titleKey: 'code', section: 'media' }]),
      createToolStub('list', [
        { icon: '<svg>ul</svg>', titleKey: 'bulletedList', name: 'bulleted-list', data: { style: 'unordered' }, section: 'basic' },
      ]),
    ];

    const entries = buildConvertMenuEntries(tools, createI18n());

    expect(entries.map((e) => e.name)).toEqual(['paragraph', 'header-2', 'bulleted-list', 'code', 'toggle-header-1', 'custom']);
  });

  it('keeps the current entry of any kind, so search finds the block\'s own type', () => {
    const paragraph = createToolStub('paragraph', [
      { icon: '<svg>p</svg>', titleKey: 'text', [CURRENT_CONVERT_VARIANT]: true } as NonNullable<BlockToolAdapter['toolbox']>[number],
    ]);

    const [entry] = buildConvertMenuEntries([paragraph], createI18n());

    expect(entry).toMatchObject({ name: 'paragraph', isCurrent: true });
  });

  it('falls back englishTitle to the raw title when no titleKey', () => {
    const external = createToolStub('external', [
      { icon: '<svg>x</svg>', title: 'External' },
    ]);

    const [entry] = buildConvertMenuEntries([external], createI18n());

    expect(entry.englishTitle).toBe('External');
  });
});

describe('buildConvertMenuItems', () => {
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
    vi.restoreAllMocks();
  });

  it('renders one plain row per entry: no tabs, no separators, full titles', () => {
    const entries = buildConvertMenuEntries([
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text' }]),
      createToolStub('header', [
        { icon: '<svg>h1</svg>', titleKey: 'tools.header.heading1', name: 'header-1', data: { level: 1 } },
        { icon: '<svg>t1</svg>', titleKey: 'tools.header.toggleHeading1', name: 'toggle-header-1', data: { level: 1, isToggleable: true } },
      ]),
    ], createI18n());

    const items = buildConvertMenuItems(entries, () => undefined);

    expect(items.map((item) => item.type ?? PopoverItemType.Default)).toEqual([
      PopoverItemType.Default, PopoverItemType.Default, PopoverItemType.Default,
    ]);
    items.forEach((item) => {
      expect(item).not.toHaveProperty('titleEl');
      expect(item).toMatchObject({ dataset: { 'blok-convert-item': 'true' } });
      expect(Object.keys((item as MenuConfigItemDefaultParams).dataset ?? {})).toEqual(['blok-convert-item']);
    });
  });

  it.each(['heading', 'toggle-heading'] as const)('marks the current %s with a trailing checkmark', (group) => {
    const popover = new PopoverDesktop({
      items: buildConvertMenuItems([
        { name: 'current-heading', title: 'Heading 1', icon: '<svg/>', toolName: 'header', group, data: { level: 1 }, isCurrent: true },
      ], () => undefined),
    });
    const root = popover.getElement();

    document.body.appendChild(root);

    try {
      const current = root.querySelector('[data-blok-item-name="current-heading"]');

      if (current === null) {
        throw new Error('Current heading is missing');
      }

      expect(current.querySelector('[data-blok-testid="popover-item-trailing-icon"]')).toContainHTML(IconCheck);
      expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      expect(current).toHaveAttribute('aria-checked', 'true');
    } finally {
      popover.destroy();
      root.remove();
    }
  });

  it.each(['Tab', 'ArrowDown'])('leaves search results unfocused until %s navigation', async (key) => {
    const activated: string[] = [];
    const popover = new PopoverDesktop({
      items: buildConvertMenuItems([
        { name: 'heading-2', title: 'Heading 2', icon: '<svg/>', toolName: 'header', group: 'heading', data: { level: 2 }, isCurrent: true },
        { name: 'paragraph', title: 'Text', icon: '<svg/>', toolName: 'paragraph' },
      ], entry => { activated.push(entry.name); }),
      searchable: true,
    });
    const root = popover.getElement();

    document.body.appendChild(root);
    popover.show();
    await Promise.resolve();

    try {
      const search = root.querySelector<HTMLInputElement>('[data-blok-testid="popover-search-input"]');
      const text = root.querySelector('[data-blok-item-name="paragraph"]');

      if (search === null || text === null) {
        throw new Error('Search or Text option is missing');
      }

      search.value = 'text';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(activated).toEqual([]);
      expect(text).not.toHaveAttribute('data-blok-focused');
      expect(search).not.toHaveAttribute('aria-activedescendant');
      search.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(text).toHaveAttribute('data-blok-focused', 'true');
      expect(text).not.toHaveAttribute('data-blok-popover-item-active');

      search.value = 'tex';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(text).not.toHaveAttribute('data-blok-focused');
      expect(search).not.toHaveAttribute('aria-activedescendant');
    } finally {
      popover.destroy();
      root.remove();
    }
  });

  it('keeps native searchable choices and their conversion payloads', () => {
    const entries = buildConvertMenuEntries([
      createToolStub('header', [
        { icon: '<svg>h2</svg>', titleKey: 'tools.header.heading2', name: 'header-2', searchTerms: ['h2'], data: { level: 2 } },
      ]),
      createToolStub('list', [
        { icon: '<svg>ol</svg>', titleKey: 'numberedList', name: 'numbered-list', searchTerms: ['ordered'], data: { style: 'ordered' } },
      ]),
    ], createI18n());
    const conversions: { toolName: string; data: ConvertMenuEntry['data'] }[] = [];
    const items = buildConvertMenuItems(entries, (entry) => {
      conversions.push({ toolName: entry.toolName, data: entry.data });
    });

    const choices = items.filter(
      (item): item is MenuConfigItemDefaultParams => item.type === undefined || item.type === PopoverItemType.Default,
    );

    expect(choices).toMatchObject([
      {
        icon: '<svg>h2</svg>',
        title: 'translated:tools.header.heading2',
        name: 'header-2',
        englishTitle: 'en:tools.header.heading2',
        searchTerms: ['h2'],
        dataset: { 'blok-convert-item': 'true' },
        closeOnActivate: true,
      },
      {
        icon: '<svg>ol</svg>',
        title: 'translated:toolNames.numberedList',
        name: 'numbered-list',
        englishTitle: 'en:toolNames.numberedList',
        searchTerms: ['ordered'],
        dataset: { 'blok-convert-item': 'true' },
        closeOnActivate: true,
      },
    ]);

    choices.forEach((item) => item.onActivate?.(item));

    expect(conversions).toEqual([
      { toolName: 'header', data: { level: 2 } },
      { toolName: 'list', data: { style: 'ordered' } },
    ]);
  });
});
