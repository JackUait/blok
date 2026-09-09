import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConvertMenuEntries, buildConvertMenuItems, type ConvertMenuEntry, type ConvertMenuI18n } from '../../../../src/components/utils/convert-menu';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
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

  it('sinks ungrouped entries below the heading tile groups', () => {
    const tools = [
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text' }]),
      createToolStub('header', [
        { icon: '<svg>h2</svg>', titleKey: 'tools.header.heading2', name: 'header-2', data: { level: 2 } },
        { icon: '<svg>t1</svg>', titleKey: 'tools.header.toggleHeading1', name: 'toggle-header-1', data: { level: 1, isToggleable: true } },
      ]),
      createToolStub('list', [
        { icon: '<svg>ul</svg>', titleKey: 'bulletedList', name: 'bulleted-list', data: { style: 'unordered' } },
      ]),
    ];

    const entries = buildConvertMenuEntries(tools, createI18n());

    expect(entries.map((e) => e.name)).toEqual(['header-2', 'toggle-header-1', 'paragraph', 'bulleted-list']);
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

  it.each<{
    description: string;
    groups: ConvertMenuEntry['group'][];
    expected: string[];
  }>([
    {
      description: 'all sections without separating entries in the same section',
      groups: ['heading', 'heading', 'toggle-heading', 'toggle-heading', undefined, undefined],
      expected: [
        'convert-heading-tabs', 'choice-0', 'choice-1',
        'choice-2', 'choice-3', 'separator',
        'choice-4', 'choice-5',
      ],
    },
    {
      description: 'headings followed directly by ordinary choices',
      groups: ['heading', undefined, undefined],
      expected: ['convert-heading-tabs', 'choice-0', 'separator', 'choice-1', 'choice-2'],
    },
    {
      description: 'toggle headings followed directly by ordinary choices',
      groups: ['toggle-heading', undefined],
      expected: ['convert-heading-tabs', 'choice-0', 'separator', 'choice-1'],
    },
    {
      description: 'heading sections without ordinary choices',
      groups: ['heading', 'toggle-heading'],
      expected: ['convert-heading-tabs', 'choice-0', 'choice-1'],
    },
    {
      description: 'only ordinary choices',
      groups: [undefined, undefined],
      expected: ['choice-0', 'choice-1'],
    },
    {
      description: 'only headings',
      groups: ['heading', 'heading'],
      expected: ['convert-heading-tabs', 'choice-0', 'choice-1'],
    },
    {
      description: 'only toggle headings',
      groups: ['toggle-heading', 'toggle-heading'],
      expected: ['convert-heading-tabs', 'choice-0', 'choice-1'],
    },
    {
      description: 'no choices',
      groups: [],
      expected: [],
    },
  ])('places native separators correctly for $description', ({ groups, expected }) => {
    const entries = groups.map((group, index): ConvertMenuEntry => ({
      group,
      icon: '<svg></svg>',
      title: `Choice ${index}`,
      name: `choice-${index}`,
      toolName: 'custom',
    }));

    const items = buildConvertMenuItems(entries, createI18n(), () => undefined);

    expect(items.map((item) => item.type === PopoverItemType.Separator ? item.type : item.name)).toEqual(expected);
  });

  it('hides unfocusable native separators during search and restores their order on clear', () => {
    const entries = buildConvertMenuEntries([
      createToolStub('header', [
        { icon: '<svg>h1</svg>', titleKey: 'tools.header.heading1' },
        { icon: '<svg>t1</svg>', titleKey: 'tools.header.toggleHeading1' },
      ]),
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text' }]),
    ], createI18n());
    const popover = new PopoverDesktop({
      items: buildConvertMenuItems(entries, createI18n(), () => undefined),
      searchable: true,
    });
    const root = popover.getElement();

    document.body.appendChild(root);

    try {
      const separators = Array.from(root.querySelectorAll<HTMLElement>('[role="separator"]'));
      const searchInput = root.querySelector<HTMLInputElement>('[data-blok-testid="popover-search-input"]');
      const itemsContainer = root.querySelector('[data-blok-popover-items]');

      expect(separators).toHaveLength(1);

      if (searchInput === null || itemsContainer === null) {
        throw new Error('Searchable conversion menu is missing its search input or items');
      }

      const originalOrder = Array.from(itemsContainer.children);

      separators.forEach((separator) => {
        expect(separator.tabIndex).toBe(-1);
        separator.focus();
        expect(separator).not.toHaveFocus();
      });

      searchInput.value = 'heading';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(root.querySelectorAll('[data-blok-convert-item]:not([data-blok-hidden])')).toHaveLength(2);
      separators.forEach((separator) => expect(separator).toHaveAttribute('data-blok-hidden', 'true'));

      searchInput.value = 'zzzz-no-result';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(root.querySelectorAll('[data-blok-convert-item]:not([data-blok-hidden])')).toHaveLength(0);
      separators.forEach((separator) => expect(separator).toHaveAttribute('data-blok-hidden', 'true'));

      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(root.querySelectorAll('[data-blok-convert-item]:not([data-blok-hidden])')).toHaveLength(2);
      separators.forEach((separator) => expect(separator).not.toHaveAttribute('data-blok-hidden'));
      Array.from(itemsContainer.children).forEach((item, index) => expect(item).toBe(originalOrder[index]));
    } finally {
      popover.destroy();
      root.remove();
    }
  });

  it('keeps translated family tabs before the searchable choices', () => {
    const entries = buildConvertMenuEntries([
      createToolStub('header', [
        { icon: '<svg>h1</svg>', titleKey: 'tools.header.heading1' },
        { icon: '<svg>t1</svg>', titleKey: 'tools.header.toggleHeading1' },
      ]),
    ], createI18n());

    const items = buildConvertMenuItems(entries, createI18n(), () => undefined);

    expect(items).toMatchObject([
      { type: PopoverItemType.Html, element: { textContent: 'translated:toolNames.headingtranslated:tools.header.toggleHeading' } },
      { title: 'translated:tools.header.heading1' },
      { title: 'translated:tools.header.toggleHeading1' },
    ]);
  });

  it.each(['heading', 'toggle-heading'] as const)('keeps the current %s selected without a checkmark', (group) => {
    const popover = new PopoverDesktop({
      items: buildConvertMenuItems([
        { name: 'current-heading', title: 'Heading 1', icon: '<svg/>', toolName: 'header', group, data: { level: 1 }, isCurrent: true },
      ], createI18n(), () => undefined),
    });
    const root = popover.getElement();

    document.body.appendChild(root);

    try {
      const current = root.querySelector('[data-blok-item-name="current-heading"]');

      if (current === null) {
        throw new Error('Current heading is missing');
      }

      expect(current.querySelector('[data-blok-testid="popover-item-trailing-icon"]')).toBeNull();
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
      ], createI18n(), entry => { activated.push(entry.name); }),
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

  it('switches families without converting and restores the chosen tab after search', () => {
    const activated: string[] = [];
    const popover = new PopoverDesktop({
      items: buildConvertMenuItems([
        { name: 'heading-1', title: 'Heading 1', icon: '<svg/>', toolName: 'header', group: 'heading', data: { level: 1 } },
        { name: 'toggle-1', title: 'Toggle heading 1', icon: '<svg/>', toolName: 'header', group: 'toggle-heading', data: { level: 1, isToggleable: true } },
      ], createI18n(), entry => { activated.push(entry.name); }),
      searchable: true,
    });
    const root = popover.getElement();

    document.body.appendChild(root);

    try {
      const heading = root.querySelector('[data-blok-item-name="heading-1"]');
      const toggle = root.querySelector('[data-blok-item-name="toggle-1"]');
      const toggleTab = root.querySelector<HTMLButtonElement>('[role="tab"][data-blok-popover-tab="toggle-heading"]');
      const search = root.querySelector<HTMLInputElement>('[data-blok-testid="popover-search-input"]');

      if (toggleTab === null || search === null) {
        throw new Error('Picker tabs or search are missing');
      }

      expect(heading).not.toHaveAttribute('data-blok-hidden');
      expect(toggle).toHaveAttribute('data-blok-hidden', 'true');
      toggleTab.click();
      expect(toggleTab).toHaveAttribute('aria-selected', 'true');
      expect(heading).toHaveAttribute('data-blok-hidden', 'true');
      expect(toggle).not.toHaveAttribute('data-blok-hidden');
      expect(activated).toEqual([]);

      search.value = 'heading';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(heading).not.toHaveAttribute('data-blok-hidden');
      expect(toggle).not.toHaveAttribute('data-blok-hidden');
      expect(toggle).toHaveAccessibleName('Toggle heading 1');

      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(heading).toHaveAttribute('data-blok-hidden', 'true');
      expect(toggle).not.toHaveAttribute('data-blok-hidden');
      expect(toggleTab).toHaveAttribute('aria-selected', 'true');
      expect(activated).toEqual([]);
    } finally {
      popover.destroy();
      root.remove();
    }
  });

  it('keeps native searchable choices and their conversion payloads across a separator', () => {
    const entries = buildConvertMenuEntries([
      createToolStub('header', [
        { icon: '<svg>h2</svg>', titleKey: 'tools.header.heading2', name: 'header-2', searchTerms: ['h2'], data: { level: 2 } },
      ]),
      createToolStub('list', [
        { icon: '<svg>ol</svg>', titleKey: 'numberedList', name: 'numbered-list', searchTerms: ['ordered'], data: { style: 'ordered' } },
      ]),
    ], createI18n());
    const conversions: { toolName: string; data: ConvertMenuEntry['data'] }[] = [];
    const items = buildConvertMenuItems(entries, createI18n(), (entry) => {
      conversions.push({ toolName: entry.toolName, data: entry.data });
    });

    expect(items[2]).toEqual({ type: PopoverItemType.Separator });

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
        dataset: { 'blok-convert-item': 'true', 'blok-convert-group': 'heading' },
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
