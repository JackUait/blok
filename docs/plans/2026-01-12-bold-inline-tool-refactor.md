# BoldInlineTool Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 2,213-line `BoldInlineTool` into three focused modules for better maintainability.

**Architecture:** Extract collapsed selection state management to `CollapsedBoldExitHandler` (singleton), move DOM utility functions to `bold-dom-utils.ts`, leaving `BoldInlineTool` as a thin coordinator for the tool interface.

**Tech Stack:** TypeScript, Vitest for unit tests, existing Playwright E2E tests for integration verification.

---

## Task 1: Create bold-dom-utils.ts with Pure Functions

**Files:**
- Create: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Test: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Create the utils directory**

```bash
mkdir -p src/components/inline-tools/utils
```

**Step 2: Write the failing test for isBoldTag**

Create `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBoldTag } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

describe('bold-dom-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('isBoldTag', () => {
    it('returns true for STRONG element', () => {
      const strong = document.createElement('strong');

      expect(isBoldTag(strong)).toBe(true);
    });

    it('returns true for B element', () => {
      const b = document.createElement('b');

      expect(isBoldTag(b)).toBe(true);
    });

    it('returns false for other elements', () => {
      const span = document.createElement('span');
      const div = document.createElement('div');

      expect(isBoldTag(span)).toBe(false);
      expect(isBoldTag(div)).toBe(false);
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Write minimal implementation**

Create `src/components/inline-tools/utils/bold-dom-utils.ts`:

```typescript
/**
 * Check if an element is a bold tag (STRONG or B)
 * @param node - The element to check
 */
export function isBoldTag(node: Element): boolean {
  const tag = node.tagName;

  return tag === 'B' || tag === 'STRONG';
}
```

**Step 5: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add isBoldTag utility function"
```

---

## Task 2: Add isBoldElement Type Guard

**Files:**
- Modify: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
import { isBoldTag, isBoldElement } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

// ... existing tests ...

describe('isBoldElement', () => {
  it('returns true for STRONG element', () => {
    const strong = document.createElement('strong');

    expect(isBoldElement(strong)).toBe(true);
  });

  it('returns true for B element', () => {
    const b = document.createElement('b');

    expect(isBoldElement(b)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isBoldElement(null)).toBe(false);
  });

  it('returns false for text nodes', () => {
    const text = document.createTextNode('hello');

    expect(isBoldElement(text)).toBe(false);
  });

  it('returns false for other elements', () => {
    const span = document.createElement('span');

    expect(isBoldElement(span)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL with "isBoldElement is not exported"

**Step 3: Write minimal implementation**

Add to `bold-dom-utils.ts`:

```typescript
/**
 * Type guard to check if a node is a bold element (STRONG or B)
 * @param node - Node to inspect
 */
export function isBoldElement(node: Node | null): node is Element {
  return Boolean(node && node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element));
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add isBoldElement type guard"
```

---

## Task 3: Add isElementEmpty Utility

**Files:**
- Modify: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
import { isBoldTag, isBoldElement, isElementEmpty } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

// ... existing tests ...

describe('isElementEmpty', () => {
  it('returns true for element with no text content', () => {
    const div = document.createElement('div');

    expect(isElementEmpty(div)).toBe(true);
  });

  it('returns true for element with empty text content', () => {
    const div = document.createElement('div');

    div.textContent = '';

    expect(isElementEmpty(div)).toBe(true);
  });

  it('returns false for element with text content', () => {
    const div = document.createElement('div');

    div.textContent = 'hello';

    expect(isElementEmpty(div)).toBe(false);
  });

  it('returns false for element with nested text content', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');

    span.textContent = 'nested';
    div.appendChild(span);

    expect(isElementEmpty(div)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `bold-dom-utils.ts`:

```typescript
/**
 * Check if an element has no text content
 * @param element - The element to check
 */
export function isElementEmpty(element: HTMLElement): boolean {
  return (element.textContent ?? '').length === 0;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add isElementEmpty utility"
```

---

## Task 4: Add hasBoldParent and findBoldElement Utilities

**Files:**
- Modify: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Write the failing tests**

Add to the test file:

```typescript
import {
  isBoldTag,
  isBoldElement,
  isElementEmpty,
  hasBoldParent,
  findBoldElement,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

// ... existing tests ...

describe('hasBoldParent', () => {
  it('returns true when node is inside a strong element', () => {
    const strong = document.createElement('strong');
    const text = document.createTextNode('bold');

    strong.appendChild(text);
    document.body.appendChild(strong);

    expect(hasBoldParent(text)).toBe(true);
  });

  it('returns true when node is the strong element itself', () => {
    const strong = document.createElement('strong');

    document.body.appendChild(strong);

    expect(hasBoldParent(strong)).toBe(true);
  });

  it('returns false when node has no bold ancestor', () => {
    const div = document.createElement('div');
    const text = document.createTextNode('normal');

    div.appendChild(text);
    document.body.appendChild(div);

    expect(hasBoldParent(text)).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasBoldParent(null)).toBe(false);
  });
});

describe('findBoldElement', () => {
  it('returns the strong element when node is inside it', () => {
    const strong = document.createElement('strong');
    const text = document.createTextNode('bold');

    strong.appendChild(text);
    document.body.appendChild(strong);

    expect(findBoldElement(text)).toBe(strong);
  });

  it('returns the element itself when it is a strong', () => {
    const strong = document.createElement('strong');

    document.body.appendChild(strong);

    expect(findBoldElement(strong)).toBe(strong);
  });

  it('returns null when no bold ancestor exists', () => {
    const div = document.createElement('div');
    const text = document.createTextNode('normal');

    div.appendChild(text);
    document.body.appendChild(div);

    expect(findBoldElement(text)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findBoldElement(null)).toBeNull();
  });

  it('converts B to STRONG when found', () => {
    const b = document.createElement('b');
    const text = document.createTextNode('bold');

    b.appendChild(text);
    document.body.appendChild(b);

    const result = findBoldElement(text);

    expect(result?.tagName).toBe('STRONG');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `bold-dom-utils.ts`:

```typescript
/**
 * Recursively check if a node or any of its parents is a bold tag
 * @param node - The node to check
 */
export function hasBoldParent(node: Node | null): boolean {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return true;
  }

  return hasBoldParent(node.parentNode);
}

/**
 * Recursively find a bold element in the parent chain
 * @param node - The node to start searching from
 */
export function findBoldElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return ensureStrongElement(node as HTMLElement);
  }

  return findBoldElement(node.parentNode);
}

/**
 * Ensure an element is a STRONG tag, converting from B if needed
 * @param element - The element to ensure is a strong tag
 */
export function ensureStrongElement(element: HTMLElement): HTMLElement {
  if (element.tagName === 'STRONG') {
    return element;
  }

  const strong = document.createElement('strong');

  if (element.hasAttributes()) {
    Array.from(element.attributes).forEach((attr) => {
      strong.setAttribute(attr.name, attr.value);
    });
  }

  while (element.firstChild) {
    strong.appendChild(element.firstChild);
  }

  element.replaceWith(strong);

  return strong;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add hasBoldParent, findBoldElement, ensureStrongElement utilities"
```

---

## Task 5: Add Text Node and Caret Utilities

**Files:**
- Modify: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Write the failing tests**

Add to the test file:

```typescript
import {
  // ... existing imports ...
  ensureTextNodeAfter,
  setCaret,
  setCaretAfterNode,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

// ... existing tests ...

describe('ensureTextNodeAfter', () => {
  it('returns existing text node if present', () => {
    const strong = document.createElement('strong');
    const text = document.createTextNode('after');

    document.body.appendChild(strong);
    document.body.appendChild(text);

    expect(ensureTextNodeAfter(strong)).toBe(text);
  });

  it('creates new text node if none exists', () => {
    const strong = document.createElement('strong');

    document.body.appendChild(strong);

    const result = ensureTextNodeAfter(strong);

    expect(result).toBeInstanceOf(Text);
    expect(result?.textContent).toBe('');
    expect(strong.nextSibling).toBe(result);
  });

  it('creates text node between bold and element sibling', () => {
    const strong = document.createElement('strong');
    const span = document.createElement('span');

    document.body.appendChild(strong);
    document.body.appendChild(span);

    const result = ensureTextNodeAfter(strong);

    expect(result).toBeInstanceOf(Text);
    expect(strong.nextSibling).toBe(result);
    expect(result?.nextSibling).toBe(span);
  });

  it('returns null if element has no parent', () => {
    const strong = document.createElement('strong');

    expect(ensureTextNodeAfter(strong)).toBeNull();
  });
});

describe('setCaret', () => {
  it('places caret at specified offset in text node', () => {
    const div = document.createElement('div');
    const text = document.createTextNode('hello');

    div.appendChild(text);
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;

    setCaret(selection, text, 2);

    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(2);
    expect(selection.isCollapsed).toBe(true);
  });
});

describe('setCaretAfterNode', () => {
  it('places caret after the specified node', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');
    const text = document.createTextNode('after');

    strong.textContent = 'bold';
    div.appendChild(strong);
    div.appendChild(text);
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;

    setCaretAfterNode(selection, strong);

    expect(selection.anchorNode).toBe(div);
    expect(selection.anchorOffset).toBe(1);
    expect(selection.isCollapsed).toBe(true);
  });

  it('does nothing for null node', () => {
    const selection = window.getSelection()!;
    const initialRangeCount = selection.rangeCount;

    setCaretAfterNode(selection, null);

    expect(selection.rangeCount).toBe(initialRangeCount);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `bold-dom-utils.ts`:

```typescript
/**
 * Ensure there is a text node immediately following the provided bold element
 * @param boldElement - Bold element that precedes the boundary
 * @returns The text node following the bold element or null if it cannot be created
 */
export function ensureTextNodeAfter(boldElement: HTMLElement): Text | null {
  const existingNext = boldElement.nextSibling;

  if (existingNext?.nodeType === Node.TEXT_NODE) {
    return existingNext as Text;
  }

  const parent = boldElement.parentNode;

  if (!parent) {
    return null;
  }

  const documentRef = boldElement.ownerDocument ?? (typeof document !== 'undefined' ? document : null);

  if (!documentRef) {
    return null;
  }

  const newNode = documentRef.createTextNode('');

  parent.insertBefore(newNode, existingNext);

  return newNode;
}

/**
 * Place caret at the provided offset within a text node
 * @param selection - Current selection
 * @param node - Target text node
 * @param offset - Offset within the text node
 */
export function setCaret(selection: Selection, node: Text, offset: number): void {
  const newRange = document.createRange();

  newRange.setStart(node, offset);
  newRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(newRange);
}

/**
 * Position caret immediately after the provided node
 * @param selection - Current selection
 * @param node - Reference node
 */
export function setCaretAfterNode(selection: Selection, node: Node | null): void {
  if (!node) {
    return;
  }

  const newRange = document.createRange();

  newRange.setStartAfter(node);
  newRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(newRange);
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add ensureTextNodeAfter, setCaret, setCaretAfterNode utilities"
```

---

## Task 6: Add resolveBoundary and isNodeWithin Utilities

**Files:**
- Modify: `src/components/inline-tools/utils/bold-dom-utils.ts`
- Modify: `test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`

**Step 1: Write the failing tests**

Add to the test file:

```typescript
import {
  // ... existing imports ...
  resolveBoundary,
  isNodeWithin,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

// ... existing tests ...

describe('resolveBoundary', () => {
  it('returns aligned boundary when still connected', () => {
    const strong = document.createElement('strong');
    const boundary = document.createTextNode('after');

    strong.textContent = 'bold';
    document.body.appendChild(strong);
    document.body.appendChild(boundary);

    const result = resolveBoundary({ boundary, boldElement: strong });

    expect(result?.boundary).toBe(boundary);
    expect(result?.boldElement).toBe(strong);
  });

  it('returns null when bold element is disconnected', () => {
    const strong = document.createElement('strong');
    const boundary = document.createTextNode('after');

    strong.textContent = 'bold';
    // Not connected to document

    const result = resolveBoundary({ boundary, boldElement: strong });

    expect(result).toBeNull();
  });

  it('creates new boundary when original is misaligned', () => {
    const strong = document.createElement('strong');
    const boundary = document.createTextNode('misaligned');

    strong.textContent = 'bold';
    document.body.appendChild(strong);
    document.body.appendChild(document.createElement('span'));
    document.body.appendChild(boundary);

    const result = resolveBoundary({ boundary, boldElement: strong });

    expect(result?.boundary).not.toBe(boundary);
    expect(result?.boundary.previousSibling).toBe(strong);
  });
});

describe('isNodeWithin', () => {
  it('returns true when target equals container', () => {
    const div = document.createElement('div');

    expect(isNodeWithin(div, div)).toBe(true);
  });

  it('returns true when target is descendant of container', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');
    const text = document.createTextNode('hello');

    span.appendChild(text);
    div.appendChild(span);

    expect(isNodeWithin(text, div)).toBe(true);
    expect(isNodeWithin(span, div)).toBe(true);
  });

  it('returns false when target is not within container', () => {
    const div1 = document.createElement('div');
    const div2 = document.createElement('div');

    expect(isNodeWithin(div1, div2)).toBe(false);
  });

  it('returns false for null target', () => {
    const div = document.createElement('div');

    expect(isNodeWithin(null, div)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add to `bold-dom-utils.ts`:

```typescript
/**
 * Resolve the boundary text node tracked for a collapsed exit record
 * @param record - Record containing boundary and boldElement
 * @returns The aligned boundary text node or null when it cannot be determined
 */
export function resolveBoundary(record: { boundary: Text; boldElement: HTMLElement }): { boundary: Text; boldElement: HTMLElement } | null {
  if (!record.boldElement.isConnected) {
    return null;
  }

  const strong = ensureStrongElement(record.boldElement);
  const boundary = record.boundary;
  const isAligned = boundary.isConnected && boundary.previousSibling === strong;
  const resolvedBoundary = isAligned ? boundary : ensureTextNodeAfter(strong);

  if (!resolvedBoundary) {
    return null;
  }

  return {
    boundary: resolvedBoundary,
    boldElement: strong,
  };
}

/**
 * Check if a node is within the provided container
 * @param target - Node to test
 * @param container - Potential ancestor container
 */
export function isNodeWithin(target: Node | null, container: Node): boolean {
  if (!target) {
    return false;
  }

  return target === container || container.contains(target);
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/utils/bold-dom-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/utils/bold-dom-utils.ts test/unit/components/inline-tools/utils/bold-dom-utils.test.ts
git commit -m "feat(bold): add resolveBoundary and isNodeWithin utilities"
```

---

## Task 7: Create CollapsedBoldExitHandler Skeleton

**Files:**
- Create: `src/components/inline-tools/collapsed-bold-exit-handler.ts`
- Create: `test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`

**Step 1: Write the failing test for singleton pattern**

Create `test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollapsedBoldExitHandler } from '../../../../src/components/inline-tools/collapsed-bold-exit-handler';

describe('CollapsedBoldExitHandler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  describe('getInstance', () => {
    it('returns a singleton instance', () => {
      const instance1 = CollapsedBoldExitHandler.getInstance();
      const instance2 = CollapsedBoldExitHandler.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('returns instance of CollapsedBoldExitHandler', () => {
      const instance = CollapsedBoldExitHandler.getInstance();

      expect(instance).toBeInstanceOf(CollapsedBoldExitHandler);
    });
  });

  describe('hasActiveRecords', () => {
    it('returns false when no records exist', () => {
      const handler = CollapsedBoldExitHandler.getInstance();

      expect(handler.hasActiveRecords()).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/components/inline-tools/collapsed-bold-exit-handler.ts`:

```typescript
import type { CollapsedExitRecord } from './types';

/**
 * Singleton handler for managing collapsed bold exit state.
 * When user toggles bold off with a collapsed caret, this tracks
 * the boundary where subsequent typing should appear.
 */
export class CollapsedBoldExitHandler {
  private static instance: CollapsedBoldExitHandler | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldExitHandler {
    if (!CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance = new CollapsedBoldExitHandler();
    }

    return CollapsedBoldExitHandler.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    CollapsedBoldExitHandler.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }
}
```

Create `src/components/inline-tools/types.ts`:

```typescript
/**
 * Record tracking a collapsed bold exit state
 */
export interface CollapsedExitRecord {
  boundary: Text;
  boldElement: HTMLElement;
  allowedLength: number;
  hasLeadingSpace: boolean;
  hasTypedContent: boolean;
  leadingWhitespace: string;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/collapsed-bold-exit-handler.ts src/components/inline-tools/types.ts test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts
git commit -m "feat(bold): add CollapsedBoldExitHandler skeleton with singleton pattern"
```

---

## Task 8: Add exitBold Method to Handler

**Files:**
- Modify: `src/components/inline-tools/collapsed-bold-exit-handler.ts`
- Modify: `test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
describe('exitBold', () => {
  it('removes empty bold element and returns range before it', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');

    div.contentEditable = 'true';
    div.appendChild(strong);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();
    const range = handler.exitBold(selection, strong);

    expect(range).toBeDefined();
    expect(div.querySelector('strong')).toBeNull();
  });

  it('creates boundary text node and tracks exit for non-empty bold', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');

    strong.textContent = 'bold';
    div.contentEditable = 'true';
    div.appendChild(strong);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();
    const range = handler.exitBold(selection, strong);

    expect(range).toBeDefined();
    expect(handler.hasActiveRecords()).toBe(true);
    expect(strong.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('sets data attribute for collapsed length on bold element', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');

    strong.textContent = 'bold';
    div.contentEditable = 'true';
    div.appendChild(strong);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();

    handler.exitBold(selection, strong);

    expect(strong.getAttribute('data-blok-bold-collapsed-length')).toBe('4');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Update `collapsed-bold-exit-handler.ts`:

```typescript
import type { CollapsedExitRecord } from './types';
import { ensureStrongElement, ensureTextNodeAfter, isElementEmpty } from './utils/bold-dom-utils';

const DATA_ATTR_COLLAPSED_LENGTH = 'data-blok-bold-collapsed-length';
const DATA_ATTR_COLLAPSED_ACTIVE = 'data-blok-bold-collapsed-active';
const DATA_ATTR_PREV_LENGTH = 'data-blok-bold-prev-length';
const DATA_ATTR_LEADING_WHITESPACE = 'data-blok-bold-leading-ws';

/**
 * Singleton handler for managing collapsed bold exit state.
 */
export class CollapsedBoldExitHandler {
  private static instance: CollapsedBoldExitHandler | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  public static getInstance(): CollapsedBoldExitHandler {
    if (!CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance = new CollapsedBoldExitHandler();
    }

    return CollapsedBoldExitHandler.instance;
  }

  public static reset(): void {
    if (CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance.records.clear();
    }
    CollapsedBoldExitHandler.instance = null;
  }

  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }

  /**
   * Exit a collapsed bold selection by moving caret outside the bold element
   * @param selection - The current selection
   * @param boldElement - The bold element to exit from
   */
  public exitBold(selection: Selection, boldElement: HTMLElement): Range | undefined {
    const normalizedBold = ensureStrongElement(boldElement);
    const parent = normalizedBold.parentNode;

    if (!parent) {
      return;
    }

    if (isElementEmpty(normalizedBold)) {
      return this.removeEmptyBoldElement(selection, normalizedBold, parent);
    }

    return this.exitBoldWithContent(selection, normalizedBold, parent);
  }

  private removeEmptyBoldElement(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    const newRange = document.createRange();

    newRange.setStartBefore(boldElement);
    newRange.collapse(true);

    parent.removeChild(boldElement);

    selection.removeAllRanges();
    selection.addRange(newRange);

    return newRange;
  }

  private exitBoldWithContent(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    boldElement.setAttribute(DATA_ATTR_COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(DATA_ATTR_PREV_LENGTH);
    boldElement.removeAttribute(DATA_ATTR_COLLAPSED_ACTIVE);
    boldElement.removeAttribute(DATA_ATTR_LEADING_WHITESPACE);

    const initialNextSibling = boldElement.nextSibling;
    const needsNewNode = !initialNextSibling || initialNextSibling.nodeType !== Node.TEXT_NODE;
    const newNode = needsNewNode ? document.createTextNode('\u200B') : null;

    if (newNode) {
      parent.insertBefore(newNode, initialNextSibling);
    }

    const boundary = (newNode ?? initialNextSibling) as Text;

    if (!needsNewNode && (boundary.textContent ?? '').length === 0) {
      boundary.textContent = '\u200B';
    }

    const newRange = document.createRange();
    const boundaryContent = boundary.textContent ?? '';
    const caretOffset = boundaryContent.startsWith('\u200B') ? 1 : 0;

    newRange.setStart(boundary, caretOffset);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);

    this.records.add({
      boundary,
      boldElement,
      allowedLength: boldElement.textContent?.length ?? 0,
      hasLeadingSpace: false,
      hasTypedContent: false,
      leadingWhitespace: '',
    });

    return newRange;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/collapsed-bold-exit-handler.ts test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts
git commit -m "feat(bold): add exitBold method to CollapsedBoldExitHandler"
```

---

## Task 9: Add maintain Method to Handler

**Files:**
- Modify: `src/components/inline-tools/collapsed-bold-exit-handler.ts`
- Modify: `test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`

**Step 1: Write the failing test**

Add to the test file:

```typescript
describe('maintain', () => {
  it('moves overflow text from bold to boundary', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');
    const boundary = document.createTextNode('\u200B');

    strong.textContent = 'bold';
    div.contentEditable = 'true';
    div.appendChild(strong);
    div.appendChild(boundary);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();

    handler.exitBold(selection, strong);

    // Simulate typing inside the bold element
    strong.textContent = 'boldX';

    handler.maintain();

    expect(strong.textContent).toBe('bold');
    expect(boundary.textContent).toContain('X');
  });

  it('removes zero-width space when boundary has content', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');

    strong.textContent = 'bold';
    div.contentEditable = 'true';
    div.appendChild(strong);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();

    handler.exitBold(selection, strong);

    const boundary = strong.nextSibling as Text;

    // Simulate typing after the ZWS
    boundary.textContent = '\u200Btyped';

    handler.maintain();

    expect(boundary.textContent).toBe('typed');
  });

  it('removes stale records for disconnected elements', () => {
    const div = document.createElement('div');
    const strong = document.createElement('strong');

    strong.textContent = 'bold';
    div.contentEditable = 'true';
    div.appendChild(strong);
    document.body.appendChild(div);
    div.focus();

    const selection = window.getSelection()!;
    const handler = CollapsedBoldExitHandler.getInstance();

    handler.exitBold(selection, strong);
    expect(handler.hasActiveRecords()).toBe(true);

    // Disconnect the element
    strong.remove();

    handler.maintain();

    expect(handler.hasActiveRecords()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Add to `collapsed-bold-exit-handler.ts`:

```typescript
import { resolveBoundary, setCaret } from './utils/bold-dom-utils';

// ... existing code ...

export class CollapsedBoldExitHandler {
  // ... existing code ...

  /**
   * Maintain the collapsed exit state by enforcing text boundaries
   */
  public maintain(): void {
    if (typeof document === 'undefined') {
      return;
    }

    for (const record of Array.from(this.records)) {
      const resolved = resolveBoundary(record);

      if (!resolved) {
        this.records.delete(record);
        continue;
      }

      record.boundary = resolved.boundary;
      record.boldElement = resolved.boldElement;

      this.enforceTextBoundary(record);
      this.cleanupZeroWidthSpace(record);
      this.updateRecordState(record);
      this.checkForRecordDeletion(record);
    }
  }

  private enforceTextBoundary(record: CollapsedExitRecord): void {
    const { boundary, boldElement, allowedLength } = record;
    const currentText = boldElement.textContent ?? '';

    if (currentText.length > allowedLength) {
      const preserved = currentText.slice(0, allowedLength);
      const extra = currentText.slice(allowedLength);

      boldElement.textContent = preserved;
      boundary.textContent = (boundary.textContent ?? '') + extra;
    }
  }

  private cleanupZeroWidthSpace(record: CollapsedExitRecord): void {
    const { boundary } = record;
    const boundaryContent = boundary.textContent ?? '';

    if (boundaryContent.length > 1 && boundaryContent.startsWith('\u200B')) {
      boundary.textContent = boundaryContent.slice(1);
    }
  }

  private updateRecordState(record: CollapsedExitRecord): void {
    const { boundary } = record;
    const boundaryText = boundary.textContent ?? '';
    const sanitizedBoundary = boundaryText.replace(/\u200B/g, '');
    const leadingMatch = sanitizedBoundary.match(/^\s+/);
    const containsTypedContent = /\S/.test(sanitizedBoundary);

    if (leadingMatch) {
      record.hasLeadingSpace = true;
      record.leadingWhitespace = leadingMatch[0];
    }

    if (containsTypedContent) {
      record.hasTypedContent = true;
    }
  }

  private checkForRecordDeletion(record: CollapsedExitRecord): void {
    const { boundary, boldElement, allowedLength } = record;
    const boundaryText = boundary.textContent ?? '';
    const sanitizedBoundary = boundaryText.replace(/\u200B/g, '');
    const selectionStartsWithZws = boundaryText.startsWith('\u200B');
    const boundaryHasVisibleLeading = /^\s/.test(sanitizedBoundary);

    const meetsDeletionCriteria = record.hasTypedContent &&
      !selectionStartsWithZws &&
      (boldElement.textContent ?? '').length <= allowedLength;

    const shouldRestoreLeadingSpace = record.hasLeadingSpace &&
      record.hasTypedContent &&
      !boundaryHasVisibleLeading;

    if (meetsDeletionCriteria && shouldRestoreLeadingSpace) {
      const trimmedActual = boundaryText.replace(/^[\u200B\s]+/, '');
      const leadingWhitespace = record.leadingWhitespace || ' ';

      boundary.textContent = `${leadingWhitespace}${trimmedActual}`;
    }

    if (meetsDeletionCriteria) {
      this.records.delete(record);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inline-tools/collapsed-bold-exit-handler.ts test/unit/components/inline-tools/collapsed-bold-exit-handler.test.ts
git commit -m "feat(bold): add maintain method to CollapsedBoldExitHandler"
```

---

## Task 10: Integrate Handler into BoldInlineTool

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Update imports**

At the top of `inline-tool-bold.ts`, add:

```typescript
import { CollapsedBoldExitHandler } from './collapsed-bold-exit-handler';
import {
  isBoldTag,
  isBoldElement,
  isElementEmpty,
  hasBoldParent,
  findBoldElement,
  ensureStrongElement,
  ensureTextNodeAfter,
  setCaret,
  setCaretAfterNode,
  isNodeWithin,
} from './utils/bold-dom-utils';
```

**Step 2: Remove duplicated static methods**

Remove these methods from `BoldInlineTool` as they are now in `bold-dom-utils.ts`:
- `isBoldTag` (lines 389-393)
- `isBoldElement` (lines 1615-1617)
- `isElementEmpty` (lines 1017-1019)
- `hasBoldParent` (lines 357-367)
- `findBoldElement` (lines 373-383)
- `ensureStrongElement` (lines 399-419)
- `ensureTextNodeAfter` (lines 286-310)
- `setCaret` (lines 1625-1633)
- `setCaretAfterNode` (lines 1640-1652)
- `isNodeWithin` (lines 1791-1797)

**Step 3: Remove collapsed exit methods moved to handler**

Remove these methods:
- `exitCollapsedBold` (lines 1909-1922)
- `removeEmptyBoldElement` (lines 1930-1942)
- `exitCollapsedBoldWithContent` (lines 1950-1992)
- `maintainCollapsedExitState` (lines 157-229)
- `resolveBoundary` (lines 317-335)

**Step 4: Update refreshSelectionState to use handler**

Replace the call to `maintainCollapsedExitState` with:

```typescript
private static refreshSelectionState(source: 'selectionchange' | 'input'): void {
  const selection = window.getSelection();

  BoldInlineTool.enforceCollapsedBoldLengths(selection);
  CollapsedBoldExitHandler.getInstance().maintain();
  BoldInlineTool.synchronizeCollapsedBold(selection);
  // ... rest of method
}
```

**Step 5: Update toggleCollapsedSelection to use handler**

Update the method to delegate to the handler:

```typescript
private toggleCollapsedSelection(): void {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const insideBold = findBoldElement(range.startContainer);

  const updatedRange = (() => {
    if (insideBold && insideBold.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) !== 'true') {
      return CollapsedBoldExitHandler.getInstance().exitBold(selection, insideBold);
    }

    const boundaryBold = insideBold ?? BoldInlineTool.getBoundaryBold(range);

    return boundaryBold
      ? CollapsedBoldExitHandler.getInstance().exitBold(selection, boundaryBold)
      : this.startCollapsedBold(range);
  })();

  // ... rest of method unchanged
}
```

**Step 6: Remove the collapsedExitRecords static property**

Remove the static property declaration:
```typescript
// Remove this:
private static readonly collapsedExitRecords = new Set<{...}>();
```

**Step 7: Run linting**

Run: `yarn lint`
Expected: PASS (or only unrelated warnings)

**Step 8: Run unit tests**

Run: `yarn test test/unit/components/inline-tools/`
Expected: PASS

**Step 9: Run E2E tests for bold**

Run: `yarn build:test && yarn e2e test/playwright/tests/inline-tools/bold.spec.ts`
Expected: PASS

**Step 10: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): integrate CollapsedBoldExitHandler and bold-dom-utils"
```

---

## Task 11: Clean Up Remaining Dead Code

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Identify remaining duplicated logic**

Search for any remaining calls to the removed static methods and update them to use the imported functions.

**Step 2: Remove any remaining unused imports or declarations**

**Step 3: Run full test suite**

Run: `yarn lint && yarn test && yarn build:test && yarn e2e test/playwright/tests/inline-tools/bold.spec.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): remove dead code after extraction"
```

---

## Task 12: Verify Line Count Reduction

**Step 1: Check file sizes**

Run: `wc -l src/components/inline-tools/inline-tool-bold.ts src/components/inline-tools/collapsed-bold-exit-handler.ts src/components/inline-tools/utils/bold-dom-utils.ts`

Expected:
- `inline-tool-bold.ts`: ~800-1000 lines (down from 2,213)
- `collapsed-bold-exit-handler.ts`: ~200-350 lines
- `bold-dom-utils.ts`: ~150-200 lines

**Step 2: Run full E2E test suite for inline tools**

Run: `yarn e2e test/playwright/tests/inline-tools/`
Expected: PASS

**Step 3: Final commit**

```bash
git add -A
git commit -m "refactor(bold): complete extraction of CollapsedBoldExitHandler and utilities

Split BoldInlineTool (2,213 lines) into three focused modules:
- BoldInlineTool: Core tool interface and range-based formatting
- CollapsedBoldExitHandler: Collapsed caret state machine
- bold-dom-utils: Shared DOM manipulation utilities"
```

---

## Summary

This plan extracts ~600 lines into two new modules:
1. `bold-dom-utils.ts` - Pure functions, easily testable
2. `CollapsedBoldExitHandler` - Singleton state machine for collapsed exits

The integration is incremental - each task is independently committable and testable. The existing E2E tests serve as regression tests throughout.
