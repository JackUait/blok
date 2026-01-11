# Bold Tool Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract shared infrastructure from `inline-tool-bold.ts` to reduce it from 1730 to ~600 lines while creating reusable utilities for all inline tools.

**Architecture:** Create two new modules: (1) `formatting-range-utils.ts` with generic pure functions for range/selection operations, (2) `inline-tool-event-manager.ts` singleton for document-level event handling. Bold and italic tools will use these shared utilities.

**Tech Stack:** TypeScript, Vitest for unit tests, DOM APIs (Range, Selection, TreeWalker)

---

## Task 1: Create formatting-range-utils.ts with createRangeTextWalker

**Files:**
- Create: `src/components/inline-tools/utils/formatting-range-utils.ts`
- Test: `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`

**Step 1: Write the failing test**

Create `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRangeTextWalker } from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

describe('formatting-range-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('createRangeTextWalker', () => {
    it('returns a TreeWalker that iterates text nodes in range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'Hello <strong>bold</strong> world';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const walker = createRangeTextWalker(range);
      const textNodes: Text[] = [];

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
      }

      expect(textNodes).toHaveLength(3);
      expect(textNodes[0].textContent).toBe('Hello ');
      expect(textNodes[1].textContent).toBe('bold');
      expect(textNodes[2].textContent).toBe(' world');
    });

    it('only includes text nodes intersecting the range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'Before <span>Inside</span> After';
      document.body.appendChild(container);

      const span = container.querySelector('span')!;
      const range = document.createRange();
      range.selectNodeContents(span);

      const walker = createRangeTextWalker(range);
      const textNodes: Text[] = [];

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
      }

      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Inside');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/components/inline-tools/utils/formatting-range-utils.ts`:

```typescript
/**
 * Check if a node intersects with a range, with Safari fallback
 * @param range - The range to check intersection with
 * @param node - The node to check
 */
const nodeIntersectsRange = (range: Range, node: Node): boolean => {
  try {
    return range.intersectsNode(node);
  } catch (_error) {
    /**
     * Safari might throw if node is detached from DOM.
     * Fall back to manual comparison by wrapping node into a range.
     */
    const nodeRange = document.createRange();

    nodeRange.selectNodeContents(node);

    const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
    const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

    return startsBeforeEnd && endsAfterStart;
  }
};

/**
 * Create a TreeWalker that iterates text nodes intersecting a range
 * @param range - The range to iterate within
 */
export const createRangeTextWalker = (range: Range): TreeWalker => {
  return document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        return nodeIntersectsRange(range, node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    }
  );
};
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/formatting-range-utils.ts test/unit/components/inline-tools/utils/formatting-range-utils.test.ts
git commit -m "feat(inline-tools): add createRangeTextWalker utility"
```

---

## Task 2: Add findFormattingAncestor and hasFormattingAncestor

**Files:**
- Modify: `src/components/inline-tools/utils/formatting-range-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`

**Step 1: Write the failing tests**

Add to `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`:

```typescript
import {
  createRangeTextWalker,
  findFormattingAncestor,
  hasFormattingAncestor,
} from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

// Add after existing describe blocks:

describe('findFormattingAncestor', () => {
  it('finds ancestor matching predicate', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>bold text</strong>';
    document.body.appendChild(container);

    const textNode = container.querySelector('strong')!.firstChild!;
    const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

    const result = findFormattingAncestor(textNode, isBold);

    expect(result).not.toBeNull();
    expect(result?.tagName).toBe('STRONG');
  });

  it('returns null when no ancestor matches', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>plain text</span>';
    document.body.appendChild(container);

    const textNode = container.querySelector('span')!.firstChild!;
    const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

    const result = findFormattingAncestor(textNode, isBold);

    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const isBold = (el: Element) => el.tagName === 'STRONG';

    expect(findFormattingAncestor(null, isBold)).toBeNull();
  });

  it('returns the element itself if it matches predicate', () => {
    const strong = document.createElement('strong');
    document.body.appendChild(strong);

    const isBold = (el: Element) => el.tagName === 'STRONG';

    const result = findFormattingAncestor(strong, isBold);

    expect(result).toBe(strong);
  });
});

describe('hasFormattingAncestor', () => {
  it('returns true when ancestor matches predicate', () => {
    const container = document.createElement('div');
    container.innerHTML = '<em>italic text</em>';
    document.body.appendChild(container);

    const textNode = container.querySelector('em')!.firstChild!;
    const isItalic = (el: Element) => el.tagName === 'EM' || el.tagName === 'I';

    expect(hasFormattingAncestor(textNode, isItalic)).toBe(true);
  });

  it('returns false when no ancestor matches', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>plain</span>';
    document.body.appendChild(container);

    const textNode = container.querySelector('span')!.firstChild!;
    const isItalic = (el: Element) => el.tagName === 'EM' || el.tagName === 'I';

    expect(hasFormattingAncestor(textNode, isItalic)).toBe(false);
  });

  it('returns false for null input', () => {
    const isItalic = (el: Element) => el.tagName === 'EM';

    expect(hasFormattingAncestor(null, isItalic)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: FAIL with "findFormattingAncestor is not exported"

**Step 3: Write minimal implementation**

Add to `src/components/inline-tools/utils/formatting-range-utils.ts`:

```typescript
/**
 * Find first ancestor element matching the predicate
 * @param node - The node to start searching from
 * @param predicate - Function to test elements
 */
export const findFormattingAncestor = (
  node: Node | null,
  predicate: (element: Element) => boolean
): HTMLElement | null => {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && predicate(node as Element)) {
    return node as HTMLElement;
  }

  return findFormattingAncestor(node.parentNode, predicate);
};

/**
 * Check if any ancestor matches the predicate
 * @param node - The node to check
 * @param predicate - Function to test elements
 */
export const hasFormattingAncestor = (
  node: Node | null,
  predicate: (element: Element) => boolean
): boolean => {
  return findFormattingAncestor(node, predicate) !== null;
};
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/formatting-range-utils.ts test/unit/components/inline-tools/utils/formatting-range-utils.test.ts
git commit -m "feat(inline-tools): add findFormattingAncestor and hasFormattingAncestor"
```

---

## Task 3: Add isRangeFormatted

**Files:**
- Modify: `src/components/inline-tools/utils/formatting-range-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`

**Step 1: Write the failing tests**

Add to `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`:

```typescript
import {
  createRangeTextWalker,
  findFormattingAncestor,
  hasFormattingAncestor,
  isRangeFormatted,
} from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

// Add after existing describe blocks:

describe('isRangeFormatted', () => {
  const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

  it('returns true when all text in range is formatted', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>all bold</strong>';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container.querySelector('strong')!);

    expect(isRangeFormatted(range, isBold)).toBe(true);
  });

  it('returns false when some text is not formatted', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>bold</strong> and plain';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    expect(isRangeFormatted(range, isBold)).toBe(false);
  });

  it('returns true for collapsed range inside formatted element', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>bold</strong>';
    document.body.appendChild(container);

    const textNode = container.querySelector('strong')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);

    expect(isRangeFormatted(range, isBold)).toBe(true);
  });

  it('returns false for collapsed range outside formatted element', () => {
    const container = document.createElement('div');
    container.innerHTML = 'plain <strong>bold</strong>';
    document.body.appendChild(container);

    const textNode = container.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);

    expect(isRangeFormatted(range, isBold)).toBe(false);
  });

  it('ignores whitespace-only nodes when option is set', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>bold</strong>   <strong>more bold</strong>';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    expect(isRangeFormatted(range, isBold, { ignoreWhitespace: true })).toBe(true);
    expect(isRangeFormatted(range, isBold, { ignoreWhitespace: false })).toBe(false);
  });

  it('returns true for empty range when start container is formatted', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong></strong>';
    document.body.appendChild(container);

    const strong = container.querySelector('strong')!;
    const range = document.createRange();
    range.selectNodeContents(strong);

    expect(isRangeFormatted(range, isBold)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: FAIL with "isRangeFormatted is not exported"

**Step 3: Write minimal implementation**

Add to `src/components/inline-tools/utils/formatting-range-utils.ts`:

```typescript
/**
 * Options for checking if a range is formatted
 */
export interface IsRangeFormattedOptions {
  /** Whether to ignore whitespace-only text nodes */
  ignoreWhitespace?: boolean;
}

/**
 * Check if all text nodes in a range have a matching formatting ancestor
 * @param range - The range to check
 * @param predicate - Function to test elements for formatting
 * @param options - Options for the check
 */
export const isRangeFormatted = (
  range: Range,
  predicate: (element: Element) => boolean,
  options: IsRangeFormattedOptions = {}
): boolean => {
  if (range.collapsed) {
    return findFormattingAncestor(range.startContainer, predicate) !== null;
  }

  const walker = createRangeTextWalker(range);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const value = textNode.textContent ?? '';

    if (options.ignoreWhitespace && value.trim().length === 0) {
      continue;
    }

    if (value.length === 0) {
      continue;
    }

    textNodes.push(textNode);
  }

  if (textNodes.length === 0) {
    return findFormattingAncestor(range.startContainer, predicate) !== null;
  }

  return textNodes.every((textNode) => hasFormattingAncestor(textNode, predicate));
};
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/formatting-range-utils.ts test/unit/components/inline-tools/utils/formatting-range-utils.test.ts
git commit -m "feat(inline-tools): add isRangeFormatted utility"
```

---

## Task 4: Add collectFormattingAncestors

**Files:**
- Modify: `src/components/inline-tools/utils/formatting-range-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`

**Step 1: Write the failing tests**

Add to `test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`:

```typescript
import {
  createRangeTextWalker,
  findFormattingAncestor,
  hasFormattingAncestor,
  isRangeFormatted,
  collectFormattingAncestors,
} from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

// Add after existing describe blocks:

describe('collectFormattingAncestors', () => {
  const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

  it('collects all unique formatting ancestors in range', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>first</strong> text <strong>second</strong>';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    const ancestors = collectFormattingAncestors(range, isBold);

    expect(ancestors).toHaveLength(2);
    expect(ancestors[0].textContent).toBe('first');
    expect(ancestors[1].textContent).toBe('second');
  });

  it('returns empty array when no formatted elements in range', () => {
    const container = document.createElement('div');
    container.innerHTML = 'plain text only';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    const ancestors = collectFormattingAncestors(range, isBold);

    expect(ancestors).toHaveLength(0);
  });

  it('deduplicates ancestors when multiple text nodes share same parent', () => {
    const container = document.createElement('div');
    container.innerHTML = '<strong>part one <em>nested</em> part two</strong>';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    const ancestors = collectFormattingAncestors(range, isBold);

    expect(ancestors).toHaveLength(1);
    expect(ancestors[0].tagName).toBe('STRONG');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: FAIL with "collectFormattingAncestors is not exported"

**Step 3: Write minimal implementation**

Add to `src/components/inline-tools/utils/formatting-range-utils.ts`:

```typescript
/**
 * Collect all unique formatting ancestors within a range
 * @param range - The range to search within
 * @param predicate - Function to test elements for formatting
 */
export const collectFormattingAncestors = (
  range: Range,
  predicate: (element: Element) => boolean
): HTMLElement[] => {
  const ancestors = new Set<HTMLElement>();
  const walker = createRangeTextWalker(range);

  while (walker.nextNode()) {
    const ancestor = findFormattingAncestor(walker.currentNode, predicate);

    if (ancestor) {
      ancestors.add(ancestor);
    }
  }

  return Array.from(ancestors);
};
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/formatting-range-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/formatting-range-utils.ts test/unit/components/inline-tools/utils/formatting-range-utils.test.ts
git commit -m "feat(inline-tools): add collectFormattingAncestors utility"
```

---

## Task 5: Update bold tool to use formatting-range-utils

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`
- Run: `test/unit/components/inline-tools/inline-tool-bold.test.ts`

**Step 1: Update imports in inline-tool-bold.ts**

At the top of `src/components/inline-tools/inline-tool-bold.ts`, add the import:

```typescript
import {
  isRangeFormatted,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';
```

**Step 2: Replace isRangeBold method**

Replace the `isRangeBold` method (lines 459-511) with:

```typescript
  /**
   * Check if a range contains bold text
   * @param range - The range to check
   * @param options - Options for checking bold status
   * @param options.ignoreWhitespace - Whether to ignore whitespace-only text nodes
   */
  private isRangeBold(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isBoldTag, options);
  }
```

**Step 3: Replace collectBoldAncestors method**

Replace the `collectBoldAncestors` method (lines 1697-1729) with:

```typescript
  /**
   * Collect all bold ancestor elements within a range
   * @param range - The range to search for bold ancestors
   */
  private collectBoldAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isBoldTag);
  }
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn test test/unit/components/inline-tools/inline-tool-bold.test.ts`
Expected: PASS (all existing tests should still pass)

**Step 5: Run lint to verify types**

Run: `yarn lint:types`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): use formatting-range-utils for range operations"
```

---

## Task 6: Update italic tool to use formatting-range-utils

**Files:**
- Modify: `src/components/inline-tools/inline-tool-italic.ts`
- Run: `test/unit/components/inline-tools/inline-tool-italic.test.ts`

**Step 1: Add imports**

At the top of `src/components/inline-tools/inline-tool-italic.ts`, add:

```typescript
import {
  isRangeFormatted,
  findFormattingAncestor,
  hasFormattingAncestor,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';
```

**Step 2: Create isItalicTag predicate**

Add near the top of the file (after imports):

```typescript
/**
 * Check if an element is an italic tag (<i> or <em>)
 * @param element - The element to check
 */
const isItalicTag = (element: Element): boolean => {
  const tag = element.tagName;

  return tag === 'I' || tag === 'EM';
};
```

**Step 3: Replace isRangeItalic method**

Replace the `isRangeItalic` method (lines 149-197) with:

```typescript
  /**
   * Check if a range contains italic text
   * @param range - The range to check
   * @param options - Options for checking italic status
   */
  private isRangeItalic(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isItalicTag, options);
  }
```

**Step 4: Replace hasItalicParent method**

Replace the `hasItalicParent` method (lines 282-292) with:

```typescript
  /**
   * Check if a node or any of its parents is an italic tag
   * @param node - The node to check
   */
  private hasItalicParent(node: Node | null): boolean {
    return hasFormattingAncestor(node, isItalicTag);
  }
```

**Step 5: Replace findItalicElement method**

Replace the `findItalicElement` method (lines 298-308) with:

```typescript
  /**
   * Find an italic element in the parent chain
   * @param node - The node to start searching from
   */
  private findItalicElement(node: Node | null): HTMLElement | null {
    return findFormattingAncestor(node, isItalicTag);
  }
```

**Step 6: Replace collectItalicAncestors method**

Replace the `collectItalicAncestors` method (lines 324-356) with:

```typescript
  /**
   * Collect all italic ancestor elements within a range
   * @param range - The range to search for italic ancestors
   */
  private collectItalicAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isItalicTag);
  }
```

**Step 7: Remove the now-unused isItalicTag instance method**

Delete the `isItalicTag` instance method (lines 314-318) since we now have it as a module-level function.

**Step 8: Run tests to verify nothing broke**

Run: `yarn test test/unit/components/inline-tools/inline-tool-italic.test.ts`
Expected: PASS

**Step 9: Run lint to verify types**

Run: `yarn lint:types`
Expected: PASS

**Step 10: Commit**

```bash
git add src/components/inline-tools/inline-tool-italic.ts
git commit -m "refactor(italic): use formatting-range-utils for range operations"
```

---

## Task 7: Create InlineToolEventManager singleton

**Files:**
- Create: `src/components/inline-tools/services/inline-tool-event-manager.ts`
- Test: `test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`

**Step 1: Create the services directory**

Run: `mkdir -p src/components/inline-tools/services`
Run: `mkdir -p test/unit/components/inline-tools/services`

**Step 2: Write the failing test**

Create `test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InlineToolEventManager,
  type InlineToolEventHandler,
} from '../../../../../src/components/inline-tools/services/inline-tool-event-manager';

describe('InlineToolEventManager', () => {
  beforeEach(() => {
    InlineToolEventManager.reset();
  });

  afterEach(() => {
    InlineToolEventManager.reset();
  });

  describe('getInstance', () => {
    it('returns the same instance on multiple calls', () => {
      const instance1 = InlineToolEventManager.getInstance();
      const instance2 = InlineToolEventManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('reset', () => {
    it('creates a new instance after reset', () => {
      const instance1 = InlineToolEventManager.getInstance();

      InlineToolEventManager.reset();

      const instance2 = InlineToolEventManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('register/unregister', () => {
    it('registers a handler', () => {
      const manager = InlineToolEventManager.getInstance();
      const handler: InlineToolEventHandler = {
        onSelectionChange: vi.fn(),
      };

      manager.register('test-tool', handler);

      expect(manager.hasHandler('test-tool')).toBe(true);
    });

    it('unregisters a handler', () => {
      const manager = InlineToolEventManager.getInstance();
      const handler: InlineToolEventHandler = {
        onSelectionChange: vi.fn(),
      };

      manager.register('test-tool', handler);
      manager.unregister('test-tool');

      expect(manager.hasHandler('test-tool')).toBe(false);
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Write minimal implementation**

Create `src/components/inline-tools/services/inline-tool-event-manager.ts`:

```typescript
/**
 * Shortcut definition for keyboard shortcuts
 */
export interface ShortcutDefinition {
  /** The key to listen for (lowercase, e.g., 'b' for Cmd+B) */
  key: string;
  /** Whether Meta key (Cmd on Mac) is required */
  meta?: boolean;
  /** Whether Ctrl key is required */
  ctrl?: boolean;
}

/**
 * Handler interface for inline tool events
 */
export interface InlineToolEventHandler {
  /** Called when keyboard shortcut fires */
  onShortcut?(event: KeyboardEvent, selection: Selection): void;

  /** Called on selection changes */
  onSelectionChange?(selection: Selection): void;

  /** Called after input events */
  onInput?(event: Event, selection: Selection): void;

  /** Called before input - return true to prevent default */
  onBeforeInput?(event: InputEvent, selection: Selection): boolean;

  /** Shortcut definition */
  shortcut?: ShortcutDefinition;

  /** Check if this handler applies to current selection context */
  isRelevant?(selection: Selection): boolean;
}

/**
 * Singleton manager for inline tool document-level events
 */
export class InlineToolEventManager {
  private static instance: InlineToolEventManager | null = null;
  private readonly handlers = new Map<string, InlineToolEventHandler>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): InlineToolEventManager {
    if (!InlineToolEventManager.instance) {
      InlineToolEventManager.instance = new InlineToolEventManager();
    }

    return InlineToolEventManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (InlineToolEventManager.instance) {
      InlineToolEventManager.instance.handlers.clear();
    }
    InlineToolEventManager.instance = null;
  }

  /**
   * Register a handler for an inline tool
   * @param toolName - Unique identifier for the tool
   * @param handler - Event handler configuration
   */
  public register(toolName: string, handler: InlineToolEventHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Unregister a handler
   * @param toolName - The tool to unregister
   */
  public unregister(toolName: string): void {
    this.handlers.delete(toolName);
  }

  /**
   * Check if a handler is registered
   * @param toolName - The tool to check
   */
  public hasHandler(toolName: string): boolean {
    return this.handlers.has(toolName);
  }
}
```

**Step 5: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/inline-tool-event-manager.ts test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts
git commit -m "feat(inline-tools): add InlineToolEventManager singleton"
```

---

## Task 8: Add event listener registration to InlineToolEventManager

**Files:**
- Modify: `src/components/inline-tools/services/inline-tool-event-manager.ts`
- Modify: `test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`

**Step 1: Write the failing tests**

Add to `test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`:

```typescript
describe('event dispatching', () => {
  it('dispatches selectionchange to relevant handlers', () => {
    const manager = InlineToolEventManager.getInstance();
    const onSelectionChange = vi.fn();

    manager.register('test-tool', {
      onSelectionChange,
      isRelevant: () => true,
    });

    document.dispatchEvent(new Event('selectionchange'));

    expect(onSelectionChange).toHaveBeenCalled();
  });

  it('does not dispatch to handlers where isRelevant returns false', () => {
    const manager = InlineToolEventManager.getInstance();
    const onSelectionChange = vi.fn();

    manager.register('test-tool', {
      onSelectionChange,
      isRelevant: () => false,
    });

    document.dispatchEvent(new Event('selectionchange'));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('dispatches input events to relevant handlers', () => {
    const manager = InlineToolEventManager.getInstance();
    const onInput = vi.fn();

    manager.register('test-tool', {
      onInput,
      isRelevant: () => true,
    });

    document.dispatchEvent(new Event('input'));

    expect(onInput).toHaveBeenCalled();
  });

  it('stops listening after reset', () => {
    const manager = InlineToolEventManager.getInstance();
    const onSelectionChange = vi.fn();

    manager.register('test-tool', {
      onSelectionChange,
      isRelevant: () => true,
    });

    InlineToolEventManager.reset();

    document.dispatchEvent(new Event('selectionchange'));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`
Expected: FAIL (selectionchange handler not called)

**Step 3: Update implementation to register listeners**

Update `src/components/inline-tools/services/inline-tool-event-manager.ts`:

```typescript
/**
 * Singleton manager for inline tool document-level events
 */
export class InlineToolEventManager {
  private static instance: InlineToolEventManager | null = null;
  private readonly handlers = new Map<string, InlineToolEventHandler>();
  private listenersRegistered = false;

  private constructor() {
    this.initializeListeners();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): InlineToolEventManager {
    if (!InlineToolEventManager.instance) {
      InlineToolEventManager.instance = new InlineToolEventManager();
    }

    return InlineToolEventManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (InlineToolEventManager.instance) {
      InlineToolEventManager.instance.removeListeners();
      InlineToolEventManager.instance.handlers.clear();
    }
    InlineToolEventManager.instance = null;
  }

  /**
   * Register a handler for an inline tool
   * @param toolName - Unique identifier for the tool
   * @param handler - Event handler configuration
   */
  public register(toolName: string, handler: InlineToolEventHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Unregister a handler
   * @param toolName - The tool to unregister
   */
  public unregister(toolName: string): void {
    this.handlers.delete(toolName);
  }

  /**
   * Check if a handler is registered
   * @param toolName - The tool to check
   */
  public hasHandler(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  /**
   * Initialize document-level event listeners
   */
  private initializeListeners(): void {
    if (typeof document === 'undefined' || this.listenersRegistered) {
      return;
    }

    document.addEventListener('selectionchange', this.handleSelectionChange, true);
    document.addEventListener('input', this.handleInput, true);
    document.addEventListener('beforeinput', this.handleBeforeInput, true);
    document.addEventListener('keydown', this.handleKeydown, true);

    this.listenersRegistered = true;
  }

  /**
   * Remove document-level event listeners
   */
  private removeListeners(): void {
    if (typeof document === 'undefined' || !this.listenersRegistered) {
      return;
    }

    document.removeEventListener('selectionchange', this.handleSelectionChange, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('beforeinput', this.handleBeforeInput, true);
    document.removeEventListener('keydown', this.handleKeydown, true);

    this.listenersRegistered = false;
  }

  /**
   * Get current selection if available
   */
  private getSelection(): Selection | null {
    return typeof window !== 'undefined' ? window.getSelection() : null;
  }

  /**
   * Handle selectionchange events
   */
  private handleSelectionChange = (): void => {
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      handler.onSelectionChange?.(selection);
    });
  };

  /**
   * Handle input events
   */
  private handleInput = (event: Event): void => {
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      handler.onInput?.(event, selection);
    });
  };

  /**
   * Handle beforeinput events
   */
  private handleBeforeInput = (event: Event): void => {
    const inputEvent = event as InputEvent;
    const selection = this.getSelection();

    if (!selection) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      const shouldPrevent = handler.onBeforeInput?.(inputEvent, selection);

      if (shouldPrevent) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    });
  };

  /**
   * Handle keydown events for shortcuts
   */
  private handleKeydown = (event: KeyboardEvent): void => {
    const selection = this.getSelection();

    if (!selection || !selection.rangeCount) {
      return;
    }

    this.handlers.forEach((handler) => {
      if (!handler.shortcut || !handler.onShortcut) {
        return;
      }

      if (!this.matchesShortcut(event, handler.shortcut)) {
        return;
      }

      if (handler.isRelevant && !handler.isRelevant(selection)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      handler.onShortcut(event, selection);
    });
  };

  /**
   * Check if a keyboard event matches a shortcut definition
   */
  private matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
    if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
      return false;
    }

    if (event.altKey) {
      return false;
    }

    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isMac = userAgent.includes('mac');

    if (shortcut.meta) {
      const primaryModifier = isMac ? event.metaKey : event.ctrlKey;

      if (!primaryModifier) {
        return false;
      }
    }

    if (shortcut.ctrl && !event.ctrlKey) {
      return false;
    }

    return true;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/services/inline-tool-event-manager.ts test/unit/components/inline-tools/services/inline-tool-event-manager.test.ts
git commit -m "feat(inline-tools): add event listener dispatching to InlineToolEventManager"
```

---

## Task 9: Update bold tool to use InlineToolEventManager

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`
- Run: existing tests

**Step 1: Add import**

Add to imports in `src/components/inline-tools/inline-tool-bold.ts`:

```typescript
import { InlineToolEventManager } from './services/inline-tool-event-manager';
```

**Step 2: Remove static listener flags and registration**

Remove these static properties (around lines 95-102):

```typescript
// DELETE these lines:
private static shortcutListenerRegistered = false;
private static selectionListenerRegistered = false;
private static inputListenerRegistered = false;
private static beforeInputListenerRegistered = false;
private static readonly globalListenersInitialized = BoldInlineTool.initializeGlobalListeners();
```

**Step 3: Simplify initializeGlobalListeners**

Replace the `initializeGlobalListeners` method (lines 125-153) with:

```typescript
  /**
   * Ensure global event listeners are registered once per document
   */
  private static initializeGlobalListeners(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }

    const manager = InlineToolEventManager.getInstance();

    if (manager.hasHandler('bold')) {
      return true;
    }

    manager.register('bold', {
      shortcut: { key: 'b', meta: true },
      onShortcut: (_event, _selection) => {
        const instance = BoldInlineTool.instances.values().next().value;

        if (instance) {
          instance.toggleBold();
        }
      },
      onSelectionChange: (selection) => {
        BoldInlineTool.refreshSelectionState('selectionchange');
      },
      onInput: (_event, selection) => {
        BoldInlineTool.refreshSelectionState('input');
      },
      onBeforeInput: (event) => {
        if (event.inputType !== 'formatBold') {
          return false;
        }

        BoldInlineTool.normalizeAllBoldTags();

        return true;
      },
      isRelevant: (selection) => BoldInlineTool.isSelectionInsideBlok(selection),
    });

    BoldInlineTool.ensureMutationObserver();

    return true;
  }
```

**Step 4: Remove the old static event handlers**

Remove these methods as they're now handled by InlineToolEventManager:

- `handleShortcut` (lines 1569-1593)
- `handleGlobalSelectionChange` (lines 1413-1415)
- `handleGlobalInput` (lines 1420-1422)
- `handleBeforeInput` (lines 1491-1509)
- `isBoldShortcut` (lines 1599-1609)
- `guardCollapsedBoundaryKeydown` (lines 1179-1220) - keep this, but call it from within the event manager handler

**Step 5: Update constructor**

Simplify the constructor to just call initializeGlobalListeners:

```typescript
  constructor() {
    if (typeof document === 'undefined') {
      return;
    }

    BoldInlineTool.instances.add(this);
    BoldInlineTool.initializeGlobalListeners();
  }
```

**Step 6: Run tests to verify nothing broke**

Run: `yarn test test/unit/components/inline-tools/inline-tool-bold.test.ts`
Expected: PASS

**Step 7: Run full test suite**

Run: `yarn test`
Expected: PASS

**Step 8: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 9: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): use InlineToolEventManager for event handling"
```

---

## Task 10: Clean up unused code in bold tool

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Identify and remove dead code**

After the refactoring, identify any methods that are no longer used:

- Check for unused private methods
- Check for unused static properties
- Check for duplicate functionality now handled by utilities

**Step 2: Run tests**

Run: `yarn test test/unit/components/inline-tools/inline-tool-bold.test.ts`
Expected: PASS

**Step 3: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): remove dead code after extraction"
```

---

## Task 11: Final verification

**Step 1: Run full test suite**

Run: `yarn test`
Expected: All tests PASS

**Step 2: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 3: Run E2E tests for inline tools**

Run: `yarn build:test && yarn e2e -g "bold\|italic"`
Expected: PASS

**Step 4: Verify line count reduction**

Run: `wc -l src/components/inline-tools/inline-tool-bold.ts`
Expected: ~600-700 lines (down from 1730)

**Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "refactor(inline-tools): complete bold tool extraction"
```
