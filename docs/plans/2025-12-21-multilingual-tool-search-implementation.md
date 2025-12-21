# Multilingual Tool Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to search for tools using English terms, their current locale, or custom aliases (e.g., "h1", "title").

**Architecture:** Extend `PopoverItemParams` with `searchTerms` and `englishTitle` properties. Modify filter logic in `PopoverDesktop` to match against all three sources. Merge user-provided `searchTerms` with library-defined ones.

**Tech Stack:** TypeScript, Vitest (unit tests), Playwright (E2E tests)

---

## Task 1: Add searchTerms to ToolboxConfigEntry type

**Files:**
- Modify: `types/tools/tool-settings.d.ts:19-48`

**Step 1: Add searchTerms property to ToolboxConfigEntry**

In `types/tools/tool-settings.d.ts`, add the `searchTerms` property to `ToolboxConfigEntry`:

```typescript
export interface ToolboxConfigEntry {
  /**
   * Tool title for Toolbox (human-readable fallback)
   */
  title?: string;

  /**
   * Translation key for the title (e.g., 'text', 'heading', 'bulletedList').
   * Used to look up translations in the toolNames.* namespace.
   * If provided, the translated value is used; otherwise falls back to title.
   */
  titleKey?: string;

  /**
   * HTML string with an icon for Toolbox
   */
  icon?: string;

  /**
   * May contain overrides for tool default data
   */
  data?: BlockToolData;

  /**
   * Unique name for the toolbox entry, used for data-blok-item-name attribute.
   * If not provided, falls back to the tool name.
   * Useful when a tool has multiple toolbox entries (e.g., list with ordered/unordered/checklist variants).
   */
  name?: string;

  /**
   * Additional search terms for the tool (e.g., ['h1', 'title', 'header']).
   * Users can search by these aliases in addition to the displayed title.
   * Terms are matched case-insensitively.
   */
  searchTerms?: string[];
}
```

**Step 2: Run type check to verify no errors**

Run: `yarn lint:types`
Expected: PASS with no errors

**Step 3: Commit**

```bash
git add types/tools/tool-settings.d.ts
git commit -m "feat(types): add searchTerms to ToolboxConfigEntry"
```

---

## Task 2: Add searchTerms to ExternalToolSettings

**Files:**
- Modify: `types/tools/tool-settings.d.ts:55-89`

**Step 1: Add searchTerms property to ExternalToolSettings**

In `types/tools/tool-settings.d.ts`, add `searchTerms` to `ExternalToolSettings`:

```typescript
export interface ExternalToolSettings<Config extends object = any> {

  /**
   * Tool's class - accepts any constructor, validated at runtime
   */
  class: ToolConstructable | ToolClass;

  /**
   * User configuration object that will be passed to the Tool's constructor
   */
  config?: ToolConfig<Config>;

  /**
   * Is need to show Inline Toolbar.
   * Can accept array of Tools for InlineToolbar or boolean.
   */
  inlineToolbar?: boolean | string[];

  /**
   * BlockTunes for Tool
   * Can accept array of tune names or boolean.
   */
  tunes?: boolean | string[];

  /**
   * Define shortcut that will render Tool
   */
  shortcut?: string;

  /**
   * Tool's Toolbox settings
   * It will be hidden from Toolbox when false is specified.
   */
  toolbox?: ToolboxConfig | false;

  /**
   * Additional search terms for finding this tool in the toolbox.
   * Merged with any searchTerms defined in the tool's toolbox config.
   * Useful for adding locale-specific search terms.
   */
  searchTerms?: string[];
}
```

**Step 2: Run type check to verify no errors**

Run: `yarn lint:types`
Expected: PASS with no errors

**Step 3: Commit**

```bash
git add types/tools/tool-settings.d.ts
git commit -m "feat(types): add searchTerms to ExternalToolSettings"
```

---

## Task 3: Add englishTitle and searchTerms to SearchableItem

**Files:**
- Modify: `src/components/utils/popover/components/search-input/search-input.types.ts:1-10`

**Step 1: Extend SearchableItem interface**

```typescript
/**
 * Item that could be searched
 */
export interface SearchableItem {
  /**
   * Items title (displayed, possibly translated)
   */
  title?: string;

  /**
   * English title for fallback search (always matches English input)
   */
  englishTitle?: string;

  /**
   * Additional search terms/aliases (e.g., ['h1', 'title'])
   */
  searchTerms?: string[];
}
```

**Step 2: Run type check to verify no errors**

Run: `yarn lint:types`
Expected: PASS with no errors

**Step 3: Commit**

```bash
git add src/components/utils/popover/components/search-input/search-input.types.ts
git commit -m "feat(popover): add englishTitle and searchTerms to SearchableItem"
```

---

## Task 4: Add getEnglishTranslation to I18n module

**Files:**
- Modify: `src/components/modules/i18n.ts`
- Modify: `src/components/i18n/locales/index.ts`

**Step 1: Export enMessages from locales/index.ts**

In `src/components/i18n/locales/index.ts`, add an export for the English messages:

```typescript
// At the top, after the existing import
import enMessages from './en/messages.json';

// ... existing code ...

/**
 * English messages dictionary - always available for fallback search.
 * @internal
 */
export { enMessages };
```

**Step 2: Add getEnglishTranslation method to I18n module**

In `src/components/modules/i18n.ts`, add the import and method. First, update the import:

```typescript
import {
  DEFAULT_LOCALE,
  loadLocale,
  getDirection,
  ALL_LOCALE_CODES,
  enMessages,
} from '../i18n/locales';
```

Then add the method to the `I18n` class (after the `t` method):

```typescript
/**
 * Get the English translation for a key.
 * Used for multilingual search - always searches against English terms.
 *
 * @param key - Translation key (e.g., 'toolNames.heading')
 * @returns English translation string, or empty string if not found
 */
public getEnglishTranslation(key: string): string {
  return enMessages[key] ?? '';
}
```

**Step 3: Run type check to verify no errors**

Run: `yarn lint:types`
Expected: PASS with no errors

**Step 4: Commit**

```bash
git add src/components/modules/i18n.ts src/components/i18n/locales/index.ts
git commit -m "feat(i18n): add getEnglishTranslation method"
```

---

## Task 5: Write unit test for multilingual filter logic

**Files:**
- Create: `test/unit/components/utils/popover/multilingual-search.test.ts`

**Step 1: Create the test file**

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Filter logic for multilingual search.
 * This is the logic that will be used in PopoverDesktop.filterItems()
 */
function matchesSearchQuery(
  item: { title?: string; englishTitle?: string; searchTerms?: string[] },
  query: string
): boolean {
  const lowerQuery = query.toLowerCase();
  const title = item.title?.toLowerCase() ?? '';
  const englishTitle = item.englishTitle?.toLowerCase() ?? '';
  const searchTerms = item.searchTerms ?? [];

  return (
    title.includes(lowerQuery) ||
    englishTitle.includes(lowerQuery) ||
    searchTerms.some(term => term.toLowerCase().includes(lowerQuery))
  );
}

describe('Multilingual Search Filter', () => {
  const headingItem = {
    title: 'Titre',           // French
    englishTitle: 'Heading',  // English
    searchTerms: ['h1', 'h2', 'h3', 'title', 'header'],
  };

  describe('matches displayed title (current locale)', () => {
    it('should match French title "Titre"', () => {
      expect(matchesSearchQuery(headingItem, 'titre')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'Titre')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'TIT')).toBe(true);
    });
  });

  describe('matches English title (automatic fallback)', () => {
    it('should match English title "Heading"', () => {
      expect(matchesSearchQuery(headingItem, 'heading')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'Heading')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'HEAD')).toBe(true);
    });
  });

  describe('matches search terms (aliases)', () => {
    it('should match alias "h1"', () => {
      expect(matchesSearchQuery(headingItem, 'h1')).toBe(true);
    });

    it('should match alias "title"', () => {
      expect(matchesSearchQuery(headingItem, 'title')).toBe(true);
    });

    it('should match alias "header"', () => {
      expect(matchesSearchQuery(headingItem, 'header')).toBe(true);
    });

    it('should be case-insensitive for aliases', () => {
      expect(matchesSearchQuery(headingItem, 'H1')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'HEADER')).toBe(true);
    });
  });

  describe('no match scenarios', () => {
    it('should not match unrelated query', () => {
      expect(matchesSearchQuery(headingItem, 'paragraph')).toBe(false);
      expect(matchesSearchQuery(headingItem, 'xyz')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty query', () => {
      // Empty query should match nothing via includes (empty string matches all)
      expect(matchesSearchQuery(headingItem, '')).toBe(true);
    });

    it('should handle item with no searchTerms', () => {
      const simpleItem = { title: 'Text', englishTitle: 'Text' };

      expect(matchesSearchQuery(simpleItem, 'text')).toBe(true);
      expect(matchesSearchQuery(simpleItem, 'xyz')).toBe(false);
    });

    it('should handle item with no englishTitle', () => {
      const localizedItem = { title: 'Texto', searchTerms: ['p'] };

      expect(matchesSearchQuery(localizedItem, 'texto')).toBe(true);
      expect(matchesSearchQuery(localizedItem, 'p')).toBe(true);
      expect(matchesSearchQuery(localizedItem, 'text')).toBe(false);
    });
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `yarn test test/unit/components/utils/popover/multilingual-search.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/unit/components/utils/popover/multilingual-search.test.ts
git commit -m "test(popover): add unit tests for multilingual search filter"
```

---

## Task 6: Update SearchInput checkItem method

**Files:**
- Modify: `src/components/utils/popover/components/search-input/search-input.ts:175-180`

**Step 1: Update checkItem to use multilingual matching**

Replace the `checkItem` method:

```typescript
/**
 * Contains logic for checking whether passed item conforms the search query.
 * Matches against: displayed title, English title, and search term aliases.
 * @param item - item to be checked
 */
private checkItem(item: SearchableItem): boolean {
  const query = this.searchQuery?.toLowerCase();

  if (query === undefined) {
    return false;
  }

  const title = item.title?.toLowerCase() ?? '';
  const englishTitle = item.englishTitle?.toLowerCase() ?? '';
  const searchTerms = item.searchTerms ?? [];

  return (
    title.includes(query) ||
    englishTitle.includes(query) ||
    searchTerms.some(term => term.toLowerCase().includes(query))
  );
}
```

**Step 2: Run unit tests to verify**

Run: `yarn test test/unit/components/utils/popover/multilingual-search.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/utils/popover/components/search-input/search-input.ts
git commit -m "feat(search): update checkItem for multilingual matching"
```

---

## Task 7: Update PopoverDesktop filterItems method

**Files:**
- Modify: `src/components/utils/popover/popover-desktop.ts:618-630`

**Step 1: Update filterItems to use multilingual matching**

Replace the `filterItems` method:

```typescript
/**
 * Filters popover items by query string.
 * Matches against: displayed title, English title, and search term aliases.
 * Used for inline slash search where typing happens in the block, not in a search input.
 * @param query - search query text
 */
public override filterItems(query: string): void {
  const lowerQuery = query.toLowerCase();

  const matchingItems = this.itemsDefault.filter(item => {
    const title = item.title?.toLowerCase() ?? '';
    const englishTitle = item.englishTitle?.toLowerCase() ?? '';
    const searchTerms = item.searchTerms ?? [];

    return (
      title.includes(lowerQuery) ||
      englishTitle.includes(lowerQuery) ||
      searchTerms.some(term => term.toLowerCase().includes(lowerQuery))
    );
  });

  this.onSearch({
    query,
    items: matchingItems,
  });
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/utils/popover/popover-desktop.ts
git commit -m "feat(popover): update filterItems for multilingual matching"
```

---

## Task 8: Update Toolbox to pass englishTitle and merged searchTerms

**Files:**
- Modify: `src/components/ui/toolbox.ts:356-396`

**Step 1: Update toPopoverItem helper to include englishTitle and searchTerms**

Find the `toPopoverItem` function inside `get toolboxItemsToBeDisplayed()` and update it:

```typescript
/**
 * Returns list of items that will be displayed in toolbox
 */
private get toolboxItemsToBeDisplayed(): PopoverItemParams[] {
  if (this._toolboxItemsToBeDisplayed) {
    return this._toolboxItemsToBeDisplayed;
  }

  /**
   * Maps tool data to popover item structure
   */
  const toPopoverItem = (toolboxItem: ToolboxConfigEntry, tool: BlockToolAdapter, displaySecondaryLabel = true): PopoverItemParams => {
    // Get English title for search fallback
    const titleKey = toolboxItem.titleKey;
    const englishTitleKey = titleKey ? `toolNames.${titleKey}` : undefined;
    const englishTitle = englishTitleKey
      ? this.api.i18n.getEnglishTranslation(englishTitleKey)
      : toolboxItem.title;

    // Merge library searchTerms with user-provided searchTerms
    const librarySearchTerms = toolboxItem.searchTerms ?? [];
    const userSearchTerms = tool.searchTerms ?? [];
    const mergedSearchTerms = [...new Set([...librarySearchTerms, ...userSearchTerms])];

    return {
      icon: toolboxItem.icon,
      title: translateToolTitle(this.i18n, toolboxItem, capitalize(tool.name)),
      name: toolboxItem.name ?? tool.name,
      onActivate: (): void => {
        void this.toolButtonActivated(tool.name, toolboxItem.data);
      },
      secondaryLabel: (tool.shortcut && displaySecondaryLabel) ? beautifyShortcut(tool.shortcut) : '',
      englishTitle,
      searchTerms: mergedSearchTerms.length > 0 ? mergedSearchTerms : undefined,
    };
  };

  const result = this.toolsToBeDisplayed
    .reduce<PopoverItemParams[]>((acc, tool) => {
      const { toolbox } = tool;

      if (toolbox === undefined) {
        return acc;
      }

      const items = Array.isArray(toolbox) ? toolbox : [ toolbox ];

      items.forEach((item, index) => {
        acc.push(toPopoverItem(item, tool, index === 0));
      });

      return acc;
    }, []);

  this._toolboxItemsToBeDisplayed = result;

  return result;
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/ui/toolbox.ts
git commit -m "feat(toolbox): pass englishTitle and merged searchTerms to popover items"
```

---

## Task 9: Add searchTerms getter to BlockToolAdapter

**Files:**
- Modify: `src/components/tools/block.ts`

**Step 1: Find the BlockToolAdapter class and add searchTerms getter**

First, find where other getters like `shortcut` are defined in `src/components/tools/block.ts`. Add a similar getter for `searchTerms`:

```typescript
/**
 * User-provided search terms from tool settings.
 * These are merged with library-defined searchTerms in the toolbox config.
 */
public get searchTerms(): string[] | undefined {
  return this.settings.searchTerms;
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/tools/block.ts
git commit -m "feat(tools): add searchTerms getter to BlockToolAdapter"
```

---

## Task 10: Add getEnglishTranslation to I18n API

**Files:**
- Modify: `types/api/i18n.d.ts`
- Modify: `src/components/modules/api/i18n.ts`

**Step 1: Add to type definition**

In `types/api/i18n.d.ts`, add the method signature:

```typescript
/**
 * Get the English translation for a key.
 * Used for multilingual search - always searches against English terms.
 *
 * @param key - Translation key (e.g., 'toolNames.heading')
 * @returns English translation string, or empty string if not found
 */
getEnglishTranslation(key: string): string;
```

**Step 2: Add to API implementation**

In `src/components/modules/api/i18n.ts`, add the method:

```typescript
/**
 * Get the English translation for a key.
 * @param key - Translation key
 * @returns English translation string
 */
public getEnglishTranslation(key: string): string {
  return this.Blok.I18n.getEnglishTranslation(key);
}
```

**Step 3: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 4: Commit**

```bash
git add types/api/i18n.d.ts src/components/modules/api/i18n.ts
git commit -m "feat(api): expose getEnglishTranslation in I18n API"
```

---

## Task 11: Add searchTerms to Paragraph tool

**Files:**
- Modify: `src/tools/paragraph/index.ts:404-410`

**Step 1: Add searchTerms to the toolbox getter**

```typescript
public static get toolbox(): ToolboxConfig {
  return {
    icon: IconText,
    title: 'Text',
    titleKey: 'text',
    searchTerms: ['p', 'paragraph', 'plain'],
  };
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/paragraph/index.ts
git commit -m "feat(paragraph): add searchTerms to toolbox config"
```

---

## Task 12: Add searchTerms to Header tool

**Files:**
- Modify: `src/tools/header/index.ts:647-655`

**Step 1: Add searchTerms to each heading level**

```typescript
public static get toolbox(): ToolboxConfig {
  return Header.DEFAULT_LEVELS.map(level => ({
    icon: level.icon,
    title: level.name,
    titleKey: level.nameKey.replace('tools.header.', ''),
    name: `header-${level.number}`,
    data: { level: level.number },
    searchTerms: [`h${level.number}`, 'title', 'header', 'heading'],
  }));
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/header/index.ts
git commit -m "feat(header): add searchTerms to toolbox config"
```

---

## Task 13: Add searchTerms to List tool

**Files:**
- Modify: `src/tools/list/index.ts:1791-1815`

**Step 1: Add searchTerms to each list type**

```typescript
public static get toolbox(): ToolboxConfig {
  return [
    {
      icon: IconListBulleted,
      title: 'Bulleted list',
      titleKey: 'bulletedList',
      data: { style: 'unordered' },
      name: 'bulleted-list',
      searchTerms: ['ul', 'bullet', 'unordered', 'list'],
    },
    {
      icon: IconListNumbered,
      title: 'Numbered list',
      titleKey: 'numberedList',
      data: { style: 'ordered' },
      name: 'numbered-list',
      searchTerms: ['ol', 'ordered', 'number', 'list'],
    },
    {
      icon: IconListChecklist,
      title: 'To-do list',
      titleKey: 'todoList',
      data: { style: 'checklist' },
      name: 'check-list',
      searchTerms: ['checkbox', 'task', 'todo', 'check', 'list'],
    },
  ];
}
```

**Step 2: Run type check**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/list/index.ts
git commit -m "feat(list): add searchTerms to toolbox config"
```

---

## Task 14: Write E2E test for multilingual search

**Files:**
- Create: `test/playwright/tests/ui/multilingual-search.spec.ts`

**Step 1: Create the E2E test file**

```typescript
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const POPOVER_ITEM_SELECTOR = `${POPOVER_SELECTOR} [data-blok-testid="popover-item"]`;

test.describe('Multilingual Tool Search', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  const initBlokWithFrenchLocale = async (page: Page): Promise<void> => {
    await page.evaluate(async (holder) => {
      const container = document.createElement('div');
      container.id = holder;
      document.body.appendChild(container);

      const { Blok } = window;

      window.blokInstance = new Blok({
        holder,
        i18n: {
          locale: 'fr',
        },
      });

      await window.blokInstance.isReady;
    }, HOLDER_ID);
  };

  test('should find header tool by alias "h1"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);

    // Focus the editor and type slash
    await page.click(`#${HOLDER_ID}`);
    await page.keyboard.type('/h1');

    // Wait for the popover and check results
    const popover = page.locator(POPOVER_SELECTOR);
    await expect(popover).toBeVisible();

    // Should find Heading 1 via "h1" alias
    const items = page.locator(POPOVER_ITEM_SELECTOR);
    const visibleItems = items.locator(':visible');
    await expect(visibleItems).toHaveCount(1);

    // The item should contain "Titre 1" (French for "Heading 1")
    await expect(visibleItems.first()).toContainText('Titre 1');
  });

  test('should find header tool by English name "heading" in French locale', async ({ page }) => {
    await initBlokWithFrenchLocale(page);

    await page.click(`#${HOLDER_ID}`);
    await page.keyboard.type('/heading');

    const popover = page.locator(POPOVER_SELECTOR);
    await expect(popover).toBeVisible();

    // Should find all heading levels via English fallback
    const items = page.locator(POPOVER_ITEM_SELECTOR);
    const visibleItems = items.locator(':visible');

    // Should have multiple heading results (Heading 1-6)
    const count = await visibleItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should find list tool by alias "ul"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);

    await page.click(`#${HOLDER_ID}`);
    await page.keyboard.type('/ul');

    const popover = page.locator(POPOVER_SELECTOR);
    await expect(popover).toBeVisible();

    // Should find bulleted list via "ul" alias
    const items = page.locator(POPOVER_ITEM_SELECTOR);
    const visibleItems = items.locator(':visible');
    await expect(visibleItems).toHaveCount(1);
  });

  test('should find paragraph tool by alias "p"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);

    await page.click(`#${HOLDER_ID}`);
    await page.keyboard.type('/p');

    const popover = page.locator(POPOVER_SELECTOR);
    await expect(popover).toBeVisible();

    // Should find paragraph via "p" alias
    const items = page.locator(POPOVER_ITEM_SELECTOR);
    const visibleItems = items.locator(':visible');

    // Paragraph should be visible
    const count = await visibleItems.count();
    expect(count).toBeGreaterThan(0);
  });
});
```

**Step 2: Build the test bundle**

Run: `yarn build:test`
Expected: Build completes successfully

**Step 3: Run the E2E test**

Run: `yarn e2e test/playwright/tests/ui/multilingual-search.spec.ts`
Expected: Tests pass

**Step 4: Commit**

```bash
git add test/playwright/tests/ui/multilingual-search.spec.ts
git commit -m "test(e2e): add multilingual tool search tests"
```

---

## Task 15: Run full test suite and verify

**Step 1: Run all unit tests**

Run: `yarn test`
Expected: All tests pass

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 3: Build for production**

Run: `yarn build`
Expected: Build succeeds

**Step 4: Run all E2E tests**

Run: `yarn e2e`
Expected: All tests pass

**Step 5: Final commit if any changes needed**

If any fixes were required, commit them:

```bash
git add -A
git commit -m "fix: address test failures from multilingual search implementation"
```
