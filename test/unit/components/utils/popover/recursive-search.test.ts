import { describe, it, expect } from 'vitest';
import { simulateInput } from '../../../../helpers/simulate';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemDefaultBaseParams } from '../../../../../types/utils/popover/popover-item';

/**
 * Helper to create a default popover item params object.
 */
const createItemParams = (overrides: Partial<PopoverItemDefaultBaseParams> & { title: string }): PopoverItemDefaultBaseParams => ({
  icon: '<svg></svg>',
  onActivate: () => {},
  ...overrides,
});

describe('Recursive Popover Search', () => {
  describe('data attributes', () => {
    it('should have promotedGroupLabel attribute defined', () => {
      expect(DATA_ATTR.promotedGroupLabel).toBe('data-blok-promoted-group-label');
    });
  });
});

describe('filterItems with promoted items', () => {
  it('should show promoted children that match the query', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'Paragraph', name: 'paragraph' }),
        createItemParams({ title: 'Heading', name: 'heading' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading 1', name: 'heading-1' }),
              createItemParams({ title: 'Heading 2', name: 'heading-2' }),
              createItemParams({ title: 'List', name: 'list' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');

    // Top-level "Heading" should be visible
    const visibleItems = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item]:not([data-blok-hidden])') ?? []);
    const visibleTitles = visibleItems.map(el => el.querySelector('[data-blok-popover-item-title]')?.textContent);

    expect(visibleTitles).toContain('Heading');
    expect(visibleTitles).toContain('Heading 1');
    expect(visibleTitles).toContain('Heading 2');
    expect(visibleTitles).not.toContain('List');

    // Group separator should exist
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');
    expect(separator?.textContent).toBe('Convert to');
    expect(separator?.getAttribute('role')).toBe('separator');
  });

  it('should collect children from items with nested children', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'Paragraph', name: 'paragraph' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
              createItemParams({ title: 'List', name: 'list' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const promotedGroupLabel = itemsContainer?.querySelector('[data-blok-promoted-group-label]');

    expect(promotedGroupLabel).not.toBeNull();
    expect(promotedGroupLabel?.textContent).toBe('Convert to');
  });

  it('should handle multi-level nesting with parent chain labels', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Level 1',
          icon: '<svg></svg>',
          name: 'level-1',
          children: {
            items: [
              {
                title: 'Level 2',
                icon: '<svg></svg>',
                name: 'level-2',
                children: {
                  items: [
                    createItemParams({ title: 'Deep Item', name: 'deep' }),
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    popover.filterItems('deep');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const labels = itemsContainer?.querySelectorAll('[data-blok-promoted-group-label]');
    const labelTexts = Array.from(labels ?? []).map(el => el.textContent);

    expect(labelTexts).toContain('Level 1 \u203A Level 2');
  });

  it('should skip permanently hidden items', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Parent',
          icon: '<svg></svg>',
          name: 'parent',
          children: {
            items: [
              createItemParams({ title: 'Visible', name: 'visible' }),
              createItemParams({ title: 'Hidden', name: 'hidden-item' }),
            ],
          },
        },
      ],
    });

    popover.toggleItemHiddenByName('hidden-item', true);

    popover.filterItems('vi');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const itemTitles = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item-title]') ?? [])
      .map(el => el.textContent);

    expect(itemTitles).toContain('Visible');
    expect(itemTitles).not.toContain('Hidden');
  });

  it('should skip items without children', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'No Children', name: 'no-children' }),
      ],
    });

    popover.filterItems('no');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const labels = itemsContainer?.querySelectorAll('[data-blok-promoted-group-label]');

    expect(labels?.length ?? 0).toBe(0);
  });

  it('should show nothing found only when both top-level and promoted are empty', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'Paragraph', name: 'paragraph' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    // Query that matches a promoted child but not top-level
    popover.filterItems('heading');
    const nothingFound = popover.getElement().querySelector('[data-blok-nothing-found-displayed]');
    expect(nothingFound).toBeNull();

    // Query that matches nothing at all
    popover.filterItems('zzzzzzz');
    const nothingFound2 = popover.getElement().querySelector('[data-blok-nothing-found-displayed]');
    expect(nothingFound2).not.toBeNull();
  });

  it('should reuse cache across keystrokes (not rebuild)', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('h');
    popover.filterItems('he');
    popover.filterItems('hea');

    // Only one group separator should exist (cache reused, not rebuilt)
    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const labels = itemsContainer?.querySelectorAll('[data-blok-promoted-group-label]');
    expect(labels?.length).toBe(1);
  });

  it('should hide top-level items that duplicate promoted items by title', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'Heading', name: 'heading' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading-convert' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const visibleItems = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item]:not([data-blok-hidden])') ?? []);
    const visibleHeadings = visibleItems.filter(el =>
      el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading'
    );

    // Only the promoted "Heading" should be visible (top-level duplicate is hidden)
    expect(visibleHeadings.length).toBe(1);

    // The promoted item should be under the "Convert to" group
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');
    expect(separator?.textContent).toBe('Convert to');
  });

  it('should keep top-level items that do not duplicate any promoted item', () => {
    const popover = new PopoverDesktop({
      items: [
        createItemParams({ title: 'Heading 1', name: 'heading-1' }),
        createItemParams({ title: 'Heading 2', name: 'heading-2' }),
        createItemParams({ title: 'Heading 3', name: 'heading-3' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading 2', name: 'heading-2-convert' }),
              createItemParams({ title: 'Heading 3', name: 'heading-3-convert' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const visibleItems = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item]:not([data-blok-hidden])') ?? []);
    const visibleTitles = visibleItems.map(el => el.querySelector('[data-blok-popover-item-title]')?.textContent);

    // Heading 1 has no promoted duplicate — stays visible at top level
    expect(visibleTitles).toContain('Heading 1');

    // Heading 2 and Heading 3 appear under "Convert to" only (top-level duplicates hidden)
    const topLevelHeading2 = visibleItems.filter(el =>
      el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading 2'
    );
    expect(topLevelHeading2.length).toBe(1);

    const topLevelHeading3 = visibleItems.filter(el =>
      el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading 3'
    );
    expect(topLevelHeading3.length).toBe(1);

    // Group separator should be present
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');
    expect(separator?.textContent).toBe('Convert to');
  });

  it('should render group separator with empty label when parent has no title or name', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          icon: '<svg></svg>',
          children: {
            items: [
              createItemParams({ title: 'Child Item', name: 'child' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('child');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');

    expect(separator).not.toBeNull();
    expect(separator?.textContent).toBe('');
  });
});

describe('cleanupPromotedItems', () => {
  it('should remove promoted items and separators when query is cleared', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).not.toBeNull();

    popover.filterItems('');

    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).toBeNull();
  });

  it('should remove promoted items on hide', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');
    popover.hide();

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).toBeNull();
  });

  it('should remove promoted items on destroy', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).not.toBeNull();

    popover.destroy();

    // After destroy, the promoted elements should have been removed
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).toBeNull();
  });

  it('should be idempotent (safe to call twice)', () => {
    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');
    popover.filterItems('');
    expect(() => popover.filterItems('')).not.toThrow();
  });
});

describe('click handling for promoted items', () => {
  it('should activate promoted item on click', () => {
    let activated = false;

    const popover = new PopoverDesktop({
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              {
                title: 'Heading',
                icon: '<svg></svg>',
                name: 'heading',
                closeOnActivate: true,
                onActivate: () => { activated = true; },
              },
            ],
          },
        },
      ],
    });

    popover.filterItems('heading');

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const promotedItem = Array.from(itemsContainer?.querySelectorAll<HTMLElement>('[data-blok-popover-item]') ?? [])
      .find(el => el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading');

    expect(promotedItem).not.toBeUndefined();
    promotedItem?.click();

    expect(activated).toBe(true);
  });
});

describe('SearchInput path (searchable popover)', () => {
  it('should show promoted children when searching via SearchInput', () => {
    const popover = new PopoverDesktop({
      searchable: true,
      items: [
        createItemParams({ title: 'Paragraph', name: 'paragraph' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
      messages: {
        nothingFound: 'Nothing found',
        search: 'Search',
      },
    });

    const searchInput = popover.getElement().querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    searchInput.value = 'heading';
    simulateInput(searchInput);

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');
    expect(separator?.textContent).toBe('Convert to');
  });

  it('should deduplicate top-level items against promoted items via SearchInput', () => {
    const popover = new PopoverDesktop({
      searchable: true,
      items: [
        createItemParams({ title: 'Heading 1', name: 'heading-1' }),
        createItemParams({ title: 'Heading 2', name: 'heading-2' }),
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading 2', name: 'heading-2-convert' }),
            ],
          },
        },
      ],
      messages: {
        nothingFound: 'Nothing found',
        search: 'Search',
      },
    });

    const searchInput = popover.getElement().querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;
    searchInput.value = 'heading';
    simulateInput(searchInput);

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const visibleItems = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item]:not([data-blok-hidden])') ?? []);
    const visibleTitles = visibleItems.map(el => el.querySelector('[data-blok-popover-item-title]')?.textContent);

    // Heading 1 stays at top level (no promoted duplicate)
    expect(visibleTitles).toContain('Heading 1');

    // Heading 2 appears only once under "Convert to"
    const heading2Items = visibleItems.filter(el =>
      el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading 2'
    );
    expect(heading2Items.length).toBe(1);
  });

  it('should clean up promoted items when SearchInput is cleared', () => {
    const popover = new PopoverDesktop({
      searchable: true,
      items: [
        {
          title: 'Convert to',
          icon: '<svg></svg>',
          name: 'convert-to',
          children: {
            items: [
              createItemParams({ title: 'Heading', name: 'heading' }),
            ],
          },
        },
      ],
      messages: {
        nothingFound: 'Nothing found',
        search: 'Search',
      },
    });

    const searchInput = popover.getElement().querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;

    searchInput.value = 'heading';
    simulateInput(searchInput);

    searchInput.value = '';
    simulateInput(searchInput);

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).toBeNull();
  });
});
