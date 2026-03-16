# Recursive Popover Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PopoverDesktop` search recursively through nested children, promoting matching child items to the top level with group label separators.

**Architecture:** `PopoverDesktop` builds a cache of promoted `PopoverItemDefault` instances from nested children on first search. Both search paths (`filterItems()` for slash search, `SearchInput` for searchable popovers) score promoted items alongside top-level items, rendering matches with group separators in the items container. Cache is destroyed on query clear, hide, or destroy.

**Tech Stack:** TypeScript, Vitest, DOM APIs

**Spec:** `docs/superpowers/specs/2026-03-16-recursive-popover-search-design.md`

---

## Chunk 1: Data Attribute + Cache Infrastructure

### Task 1: Add `promotedGroupLabel` data attribute

**Files:**
- Modify: `src/components/constants/data-attributes.ts` (Popover Nesting section)
- Create: `test/unit/components/utils/popover/recursive-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/utils/popover/recursive-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';

describe('Recursive Popover Search', () => {
  describe('data attributes', () => {
    it('should have promotedGroupLabel attribute defined', () => {
      expect(DATA_ATTR.promotedGroupLabel).toBe('data-blok-promoted-group-label');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts`
Expected: FAIL — `DATA_ATTR.promotedGroupLabel` is undefined

- [ ] **Step 3: Add the data attribute**

In `src/components/constants/data-attributes.ts`, inside the "Popover Nesting" section (after `nestedLevel`), add:

```typescript
  /** Group label for promoted search results from nested children */
  promotedGroupLabel: 'data-blok-promoted-group-label',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/constants/data-attributes.ts test/unit/components/utils/popover/recursive-search.test.ts
git commit -m "feat(popover): add promotedGroupLabel data attribute"
```

---

### Task 2: Implement `buildPromotedItemCache()`, `cleanupPromotedItems()`, `createGroupSeparator()`

These are the infrastructure methods on `PopoverDesktop`. They are exercised by Task 3's tests.

**Files:**
- Modify: `src/components/utils/popover/popover-desktop.ts`

- [ ] **Step 1: Add missing imports**

In `src/components/utils/popover/popover-desktop.ts`, update the import at line 6 to include `PopoverItemType`:

```typescript
import { PopoverItemSeparator, css as popoverItemCls, PopoverItemDefault, PopoverItemType } from './components/popover-item';
```

Add the type import for `PopoverItemDefaultParams`:

```typescript
import type { PopoverItemDefaultParams } from '@/types/utils/popover/popover-item';
```

Also import `PopoverItem` if not already in the type import at line 5:

```typescript
import type { PopoverItem, PopoverItemRenderParamsMap } from './components/popover-item';
```

(This import already exists at line 5.)

- [ ] **Step 2: Add new private state**

After the `originalItemOrder` property (around line 79), add:

```typescript
/**
 * Cache of promoted items built from nested children.
 * Built once on first non-empty search, destroyed on clear/hide/destroy.
 */
private promotedItemCache: {
  items: PopoverItemDefault[];
  parentChains: Map<PopoverItemDefault, string[]>;
} | null = null;

/**
 * Temporary group separator elements injected during search.
 */
private promotedSeparators: HTMLElement[] = [];
```

- [ ] **Step 3: Add `buildPromotedItemCache()` method**

```typescript
/**
 * Builds cache of PopoverItemDefault instances from nested children.
 * Recursively walks the item tree to arbitrary depth.
 * Each cached item is mapped to its parent chain for group labeling.
 */
private buildPromotedItemCache(): { items: PopoverItemDefault[]; parentChains: Map<PopoverItemDefault, string[]> } {
  const cache = {
    items: [] as PopoverItemDefault[],
    parentChains: new Map<PopoverItemDefault, string[]>(),
  };

  const collectChildren = (items: PopoverItem[], parentChain: string[]): void => {
    for (const item of items) {
      if (!(item instanceof PopoverItemDefault)) {
        continue;
      }
      if (!item.hasChildren) {
        continue;
      }

      const label = item.title ?? item.name ?? '';
      const newChain = [...parentChain, label];

      // Construct child instances directly with default render params
      for (const childParam of item.children) {
        if (childParam.type !== undefined && childParam.type !== PopoverItemType.Default) {
          continue;
        }

        const childInstance = new PopoverItemDefault(childParam as PopoverItemDefaultParams);

        if (childInstance.name !== undefined && this.isNamePermanentlyHidden(childInstance.name)) {
          childInstance.destroy();
          continue;
        }

        cache.items.push(childInstance);
        cache.parentChains.set(childInstance, newChain);

        // Recurse into child's own children (arbitrary depth)
        if (childInstance.hasChildren) {
          collectChildren([childInstance], newChain);
        }
      }
    }
  };

  collectChildren(this.items, []);

  return cache;
}
```

- [ ] **Step 4: Add `cleanupPromotedItems()` method**

```typescript
/**
 * Removes promoted items and group separators from DOM and destroys cached instances.
 * Idempotent — safe to call when cache is already null.
 */
private cleanupPromotedItems(): void {
  for (const separator of this.promotedSeparators) {
    separator.remove();
  }
  this.promotedSeparators = [];

  if (this.promotedItemCache !== null) {
    for (const item of this.promotedItemCache.items) {
      item.getElement()?.remove();
      item.destroy();
    }
    this.promotedItemCache = null;
  }
}
```

- [ ] **Step 5: Add `createGroupSeparator()` method**

```typescript
/**
 * Creates a group separator element for promoted search results.
 * @param label - the parent chain label (e.g., "Convert to" or "Parent › Child")
 */
private createGroupSeparator(label: string): HTMLElement {
  const el = document.createElement('div');

  el.setAttribute(DATA_ATTR.promotedGroupLabel, '');
  el.setAttribute('role', 'separator');
  el.className = 'px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-text/50 cursor-default';
  el.textContent = label;

  return el;
}
```

- [ ] **Step 6: Add cleanup call to `hide()`**

Modify the existing `hide` method. Add `this.cleanupPromotedItems()` as the first line:

```typescript
public hide = (): void => {
  this.cleanupPromotedItems();
  super.hide();

  this.destroyNestedPopoverIfExists();

  this.flipper?.deactivate();

  this.previouslyHoveredItem = null;
};
```

Note: `destroy()` already calls `this.hide()`, so cleanup is covered transitively. No change needed in `destroy()`.

- [ ] **Step 7: Verify lint passes**

Run: `yarn lint src/components/utils/popover/popover-desktop.ts`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/components/utils/popover/popover-desktop.ts
git commit -m "feat(popover): add promoted item cache and cleanup infrastructure"
```

---

## Chunk 2: Integrate Recursive Search Into Both Paths (Atomic)

### Task 3: Modify `filterItems()`, `onSearch()`, and `addSearch()` together

Both search paths must be updated atomically to avoid an intermediate broken state where `onSearch` has the new signature but `addSearch` still passes the old shape.

**Files:**
- Modify: `src/components/utils/popover/popover-desktop.ts` (filterItems, onSearch, addSearch methods)
- Modify: `test/unit/components/utils/popover/recursive-search.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/components/utils/popover/recursive-search.test.ts`:

```typescript
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

    expect(labelTexts).toContain('Level 1 › Level 2');
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

    // toggleItemHiddenByName registers the name in permanentlyHiddenNames
    // even though no top-level item matches. The cache builder uses
    // isNamePermanentlyHidden() to skip it during construction.
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

  it('should show both top-level and promoted duplicates without dedup', () => {
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
    const headingItems = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item-title]') ?? [])
      .filter(el => el.textContent === 'Heading');

    // Both the top-level and promoted "Heading" should appear
    expect(headingItems.length).toBe(2);
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
    // (even though the popover itself is also destroyed)
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
    searchInput.dispatchEvent(new Event('input'));

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    const separator = itemsContainer?.querySelector('[data-blok-promoted-group-label]');
    expect(separator?.textContent).toBe('Convert to');
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
    searchInput.dispatchEvent(new Event('input'));

    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));

    const itemsContainer = popover.getElement().querySelector('[data-blok-popover-items]');
    expect(itemsContainer?.querySelector('[data-blok-promoted-group-label]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts`
Expected: FAIL — promoted items not rendered

- [ ] **Step 3: Replace `filterItems()` method**

In `popover-desktop.ts`, replace the `filterItems` method:

```typescript
public override filterItems(query: string): void {
  if (query === '') {
    this.cleanupPromotedItems();
    this.onSearch({
      query,
      topLevelItems: this.itemsDefault,
      promotedItems: [],
    });

    return;
  }

  // Build cache on first non-empty search
  if (this.promotedItemCache === null) {
    this.promotedItemCache = this.buildPromotedItemCache();
  }

  // Score top-level items
  const topLevelScored = this.itemsDefault
    .map(item => ({ item, score: scoreSearchMatch(item, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  // Score promoted items from cache
  const promotedScored = this.promotedItemCache.items
    .map(item => ({
      item,
      score: scoreSearchMatch(item, query),
      chain: this.promotedItemCache!.parentChains.get(item) ?? [],
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  this.onSearch({
    query,
    topLevelItems: topLevelScored.map(({ item }) => item),
    promotedItems: promotedScored,
  });
}
```

- [ ] **Step 4: Replace `onSearch()` method**

Replace the `onSearch` method with:

```typescript
/**
 * Handles search results from both filterItems and SearchInput.
 * Renders top-level matches and promoted children with group separators.
 */
private onSearch = (data: {
  query: string;
  topLevelItems: PopoverItemDefault[] | SearchableItem[];
  promotedItems: Array<{ item: PopoverItemDefault; score: number; chain: string[] }>;
}): void => {
  const isEmptyQuery = data.query === '';
  const matchingTopLevel = data.topLevelItems as unknown as PopoverItemDefault[];
  const isNothingFound = matchingTopLevel.length === 0 && data.promotedItems.length === 0;

  /**
   * When nothing is found, disable transitions so items hide instantly.
   */
  if (isNothingFound) {
    this.items.forEach(item => {
      item.getElement()?.style.setProperty('transition-duration', '0s');
    });
  }

  this.items
    .forEach((item) => {
      const isDefaultItem = item instanceof PopoverItemDefault;
      const isSeparatorOrHtml = item instanceof PopoverItemSeparator || item instanceof PopoverItemHtml;
      const isHidden = isDefaultItem
        ? !matchingTopLevel.includes(item) || (item.name !== undefined && this.isNamePermanentlyHidden(item.name))
        : isSeparatorOrHtml && (isNothingFound || !isEmptyQuery);

      item.toggleHidden(isHidden);
    });

  if (isNothingFound) {
    this.nodes.popoverContainer.offsetHeight;
    this.items.forEach(item => {
      item.getElement()?.style.removeProperty('transition-duration');
    });
  }

  // Reorder top-level DOM elements to reflect ranking
  if (!isEmptyQuery && matchingTopLevel.length > 0) {
    this.reorderItemsByRank(matchingTopLevel);
  } else if (isEmptyQuery && this.originalItemOrder !== undefined) {
    this.restoreOriginalItemOrder();
  }

  // Detach previous promoted elements from DOM (don't destroy cache)
  for (const separator of this.promotedSeparators) {
    separator.remove();
  }
  this.promotedSeparators = [];

  if (this.promotedItemCache !== null) {
    for (const item of this.promotedItemCache.items) {
      item.getElement()?.remove();
    }
  }

  // Render promoted items grouped by parent chain
  if (data.promotedItems.length > 0) {
    const groups = new Map<string, Array<{ item: PopoverItemDefault; score: number }>>();

    for (const entry of data.promotedItems) {
      const label = entry.chain.join(' \u203A ');

      if (!groups.has(label)) {
        groups.set(label, []);
      }

      groups.get(label)!.push({ item: entry.item, score: entry.score });
    }

    // Sort groups by best score in each group
    const sortedGroups = [...groups.entries()].sort((a, b) => {
      const bestA = Math.max(...a[1].map(e => e.score));
      const bestB = Math.max(...b[1].map(e => e.score));

      return bestB - bestA;
    });

    for (const [label, groupItems] of sortedGroups) {
      const separator = this.createGroupSeparator(label);

      this.promotedSeparators.push(separator);
      this.nodes.items?.appendChild(separator);

      for (const { item } of groupItems) {
        const el = item.getElement();

        if (el !== null) {
          this.nodes.items?.appendChild(el);
        }
      }
    }
  }

  this.toggleNothingFoundMessage(isNothingFound);

  // Build flippable elements list: top-level matches + promoted items
  const topLevelFlippable = isEmptyQuery
    ? this.flippableElements
    : matchingTopLevel.map(item => item.getElement());

  const promotedFlippable = data.promotedItems.map(({ item }) => item.getElement());

  const flippableElements = [
    ...topLevelFlippable,
    ...promotedFlippable,
  ].filter((el): el is HTMLElement => el !== null);

  if (!this.flipper?.isActivated) {
    return;
  }

  this.flipper.deactivate();
  this.flipper.activate(flippableElements);

  if (flippableElements.length > 0) {
    this.flipper.focusItem(0, { skipNextTab: true });
  }
};
```

- [ ] **Step 5: Replace `addSearch()` method**

Replace the `addSearch` method to intercept SearchInput events and augment with promoted items:

```typescript
private addSearch(): void {
  this.search = new SearchInput({
    items: this.itemsDefault,
    placeholder: this.messages.search,
  });

  this.search.on(SearchInputEvent.Search, (searchData: { query: string; items: SearchableItem[] }) => {
    const isEmptyQuery = searchData.query === '';

    if (isEmptyQuery) {
      this.cleanupPromotedItems();
      this.onSearch({
        query: searchData.query,
        topLevelItems: searchData.items as unknown as PopoverItemDefault[],
        promotedItems: [],
      });

      return;
    }

    // Build cache on first non-empty search
    if (this.promotedItemCache === null) {
      this.promotedItemCache = this.buildPromotedItemCache();
    }

    // Score promoted items against the query
    const promotedScored = this.promotedItemCache.items
      .map(item => ({
        item,
        score: scoreSearchMatch(item, searchData.query),
        chain: this.promotedItemCache!.parentChains.get(item) ?? [],
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    this.onSearch({
      query: searchData.query,
      topLevelItems: searchData.items as unknown as PopoverItemDefault[],
      promotedItems: promotedScored,
    });
  });

  const searchElement = this.search.getElement();

  searchElement.classList.add('mb-1.5');

  this.nodes.popoverContainer.insertBefore(searchElement, this.nodes.popoverContainer.firstChild);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/utils/popover/popover-desktop.ts test/unit/components/utils/popover/recursive-search.test.ts
git commit -m "feat(popover): integrate recursive search into both search paths"
```

---

## Chunk 3: Click Handling + Full Verification

### Task 4: Override `getTargetItem()` for promoted items

**Files:**
- Modify: `src/components/utils/popover/popover-desktop.ts`
- Modify: `test/unit/components/utils/popover/recursive-search.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/components/utils/popover/recursive-search.test.ts`:

```typescript
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
    const promotedItem = Array.from(itemsContainer?.querySelectorAll('[data-blok-popover-item]') ?? [])
      .find(el => el.querySelector('[data-blok-popover-item-title]')?.textContent === 'Heading');

    expect(promotedItem).not.toBeUndefined();
    promotedItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(activated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts -t "should activate promoted item on click"`
Expected: FAIL — `activated` is still false

- [ ] **Step 3: Override `getTargetItem()` in PopoverDesktop**

Add the override in `popover-desktop.ts`:

```typescript
/**
 * Retrieves popover item that is the target of the specified event.
 * Overridden to include promoted items from recursive search.
 * @param event - event to retrieve popover item from
 */
protected override getTargetItem(event: Event): PopoverItemDefault | PopoverItemHtml | undefined {
  const allItems = this.promotedItemCache !== null
    ? [...this.items, ...this.promotedItemCache.items]
    : this.items;

  return allItems
    .filter((item): item is PopoverItemDefault | PopoverItemHtml =>
      item instanceof PopoverItemDefault || item instanceof PopoverItemHtml
    )
    .find(item => {
      const itemEl = item.getElement();

      if (itemEl === null) {
        return false;
      }

      return event.composedPath().includes(itemEl);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts -t "should activate promoted item on click"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/popover/popover-desktop.ts test/unit/components/utils/popover/recursive-search.test.ts
git commit -m "feat(popover): override getTargetItem to support promoted item clicks"
```

---

### Task 5: Run full test suite and lint

**Files:**
- No new files — verification only

- [ ] **Step 1: Run the recursive search tests**

Run: `yarn test test/unit/components/utils/popover/recursive-search.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run the existing popover search tests**

Run: `yarn test test/unit/components/utils/popover/multilingual-search.test.ts test/unit/utils/search-input.test.ts`
Expected: All tests PASS (no regressions)

- [ ] **Step 3: Run the full unit test suite**

Run: `yarn test`
Expected: All tests PASS

- [ ] **Step 4: Run lint**

Run: `yarn lint`
Expected: No new errors

- [ ] **Step 5: Commit any fixes if needed**

```bash
git add -A
git commit -m "test(popover): verify recursive search with full suite"
```
