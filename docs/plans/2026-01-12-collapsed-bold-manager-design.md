# Collapsed Bold Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Extract collapsed selection logic from `inline-tool-bold.ts` into a unified `CollapsedBoldManager` singleton, reducing file size by ~60% while preserving all existing behavior.

**Architecture:** The manager consolidates all collapsed bold operations (enter, exit, synchronize, enforce lengths, boundary guards) into a single class. It absorbs the existing `CollapsedBoldExitHandler` and extracts static methods from `BoldInlineTool`. The refactor is incremental—one method at a time with tests passing after each step.

**Tech Stack:** TypeScript, Vitest (unit tests), Playwright (E2E tests)

---

## Task 1: Create CollapsedBoldManager Shell

**Files:**
- Create: `src/components/inline-tools/services/collapsed-bold-manager.ts`

**Step 1: Create the empty manager class with singleton pattern and data attributes**

```typescript
import type { CollapsedExitRecord } from '../types';
import { ensureStrongElement, isElementEmpty, resolveBoundary } from '../utils/bold-dom-utils';

/**
 * Centralized data attributes for collapsed bold state tracking
 */
const ATTR = {
  COLLAPSED_LENGTH: 'data-blok-bold-collapsed-length',
  COLLAPSED_ACTIVE: 'data-blok-bold-collapsed-active',
  PREV_LENGTH: 'data-blok-bold-prev-length',
  LEADING_WHITESPACE: 'data-blok-bold-leading-ws',
} as const;

/**
 * Unified manager for collapsed bold selection behavior.
 * Consolidates enter/exit logic, typeahead absorption, and boundary guards.
 */
export class CollapsedBoldManager {
  private static instance: CollapsedBoldManager | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldManager {
    if (!CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance = new CollapsedBoldManager();
    }

    return CollapsedBoldManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance.records.clear();
    }
    CollapsedBoldManager.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }

  /**
   * Check if an element is an active collapsed bold placeholder
   * Used by BoldNormalizationPass to avoid removing elements in use
   * @param element - The element to check
   */
  public isActivePlaceholder(element: HTMLElement): boolean {
    return element.getAttribute(ATTR.COLLAPSED_ACTIVE) === 'true' ||
           element.hasAttribute(ATTR.COLLAPSED_LENGTH);
  }

  /**
   * Get the ATTR constants for external use
   */
  public static get ATTR(): typeof ATTR {
    return ATTR;
  }
}
```

**Step 2: Run lint to verify the new file compiles**

Run: `yarn lint`
Expected: PASS (no errors in new file)

**Step 3: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts
git commit -m "refactor(bold): create CollapsedBoldManager shell with singleton pattern"
```

---

## Task 2: Move exit() Method from CollapsedBoldExitHandler

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts:398-420` (update import)
- Reference: `src/components/inline-tools/collapsed-bold-exit-handler.ts` (copy logic)

**Step 1: Add exit() and helper methods to CollapsedBoldManager**

Add after `isActivePlaceholder()` in `collapsed-bold-manager.ts`:

```typescript
  /**
   * Exit a collapsed bold selection by moving caret outside the bold element
   * @param selection - The current selection
   * @param boldElement - The bold element to exit from
   */
  public exit(selection: Selection, boldElement: HTMLElement): Range | undefined {
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
    boldElement.setAttribute(ATTR.COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(ATTR.PREV_LENGTH);
    boldElement.removeAttribute(ATTR.COLLAPSED_ACTIVE);
    boldElement.removeAttribute(ATTR.LEADING_WHITESPACE);

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
      boundary.textContent = extra + (boundary.textContent ?? '');
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
```

**Step 2: Update import in inline-tool-bold.ts**

Replace the import line at the top of the file:

```typescript
// BEFORE
import { CollapsedBoldExitHandler } from './collapsed-bold-exit-handler';

// AFTER
import { CollapsedBoldManager } from './services/collapsed-bold-manager';
```

**Step 3: Update usages of CollapsedBoldExitHandler in inline-tool-bold.ts**

Replace in `toggleCollapsedSelection()` method (~line 398):

```typescript
// BEFORE
return CollapsedBoldExitHandler.getInstance().exitBold(selection, insideBold);
// ...
return CollapsedBoldExitHandler.getInstance().exitBold(selection, boundaryBold)

// AFTER
return CollapsedBoldManager.getInstance().exit(selection, insideBold);
// ...
return CollapsedBoldManager.getInstance().exit(selection, boundaryBold)
```

Replace in `refreshSelectionState()` method (~line 613):

```typescript
// BEFORE
CollapsedBoldExitHandler.getInstance().maintain();

// AFTER
CollapsedBoldManager.getInstance().maintain();
```

**Step 4: Run E2E tests to verify behavior unchanged**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 5: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move exit() from CollapsedBoldExitHandler to CollapsedBoldManager"
```

---

## Task 3: Move enter() Method (startCollapsedBold)

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Add enter() and helper methods to CollapsedBoldManager**

Add to `collapsed-bold-manager.ts` before `exit()`:

```typescript
  /**
   * Enter collapsed bold mode by inserting an empty <strong> for typing
   * @param range - Current collapsed range
   * @param mergeCallback - Callback to merge adjacent bold elements
   */
  public enter(
    range: Range,
    mergeCallback: (element: HTMLElement) => HTMLElement
  ): Range | undefined {
    if (!range.collapsed) {
      return;
    }

    const strong = document.createElement('strong');
    const textNode = document.createTextNode('');

    strong.appendChild(textNode);
    strong.setAttribute(ATTR.COLLAPSED_ACTIVE, 'true');

    const container = range.startContainer;
    const offset = range.startOffset;

    const insertionSucceeded = (() => {
      if (container.nodeType === Node.TEXT_NODE) {
        return this.insertCollapsedBoldIntoText(container as Text, strong, offset);
      }

      if (container.nodeType === Node.ELEMENT_NODE) {
        this.insertCollapsedBoldIntoElement(container as Element, strong, offset);

        return true;
      }

      return false;
    })();

    if (!insertionSucceeded) {
      return;
    }

    const newRange = document.createRange();

    newRange.setStart(textNode, 0);
    newRange.collapse(true);

    const merged = mergeCallback(strong);

    return merged.firstChild instanceof Text ? (() => {
      const caretRange = document.createRange();

      caretRange.setStart(merged.firstChild, merged.firstChild.textContent?.length ?? 0);
      caretRange.collapse(true);

      return caretRange;
    })() : newRange;
  }

  /**
   * Insert a collapsed bold wrapper when the caret resides inside a text node
   */
  private insertCollapsedBoldIntoText(text: Text, strong: HTMLElement, offset: number): boolean {
    const parent = text.parentNode;

    if (!parent) {
      return false;
    }

    const content = text.textContent ?? '';
    const before = content.slice(0, offset);
    const after = content.slice(offset);

    text.textContent = before;

    const afterNode = after.length ? document.createTextNode(after) : null;

    if (afterNode) {
      parent.insertBefore(afterNode, text.nextSibling);
    }

    parent.insertBefore(strong, afterNode ?? text.nextSibling);
    strong.setAttribute(ATTR.PREV_LENGTH, before.length.toString());

    return true;
  }

  /**
   * Insert a collapsed bold wrapper directly into an element container
   */
  private insertCollapsedBoldIntoElement(element: Element, strong: HTMLElement, offset: number): void {
    const referenceNode = element.childNodes[offset] ?? null;

    element.insertBefore(strong, referenceNode);
    strong.setAttribute(ATTR.PREV_LENGTH, '0');
  }
```

**Step 2: Update startCollapsedBold() in inline-tool-bold.ts to delegate**

Replace the `startCollapsedBold` method body:

```typescript
  /**
   * Insert a bold wrapper at the caret so newly typed text becomes bold
   * @param range - Current collapsed range
   */
  private startCollapsedBold(range: Range): Range | undefined {
    const manager = CollapsedBoldManager.getInstance();
    const resultRange = manager.enter(range, (strong) => this.mergeAdjacentBold(strong));

    const selection = window.getSelection();

    BoldNormalizationPass.normalizeAroundSelection(selection);

    if (selection && resultRange) {
      selection.removeAllRanges();
      selection.addRange(resultRange);
    }

    this.notifySelectionChange();

    return resultRange;
  }
```

**Step 3: Remove the now-unused helper methods from BoldInlineTool**

Delete these methods from `inline-tool-bold.ts`:
- `insertCollapsedBoldIntoText` (~lines 454-476)
- `insertCollapsedBoldIntoElement` (~lines 483-491)

**Step 4: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 5: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move enter() (startCollapsedBold) to CollapsedBoldManager"
```

---

## Task 4: Move synchronize() Method

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Add synchronize() to CollapsedBoldManager**

Add import at top of `collapsed-bold-manager.ts`:

```typescript
import { DATA_ATTR, createSelector } from '../../constants';
import { isNodeWithin } from '../utils/bold-dom-utils';
```

Add method to `CollapsedBoldManager`:

```typescript
  /**
   * Ensure collapsed bold placeholders absorb newly typed text
   * @param selection - The current selection to determine the blok context
   */
  public synchronize(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor)) ?? element?.ownerDocument;

    if (!root) {
      return;
    }

    const selector = `strong[${ATTR.COLLAPSED_ACTIVE}="true"]`;

    root.querySelectorAll<HTMLElement>(selector).forEach((boldElement) => {
      const prevLengthAttr = boldElement.getAttribute(ATTR.PREV_LENGTH);
      const prevNode = boldElement.previousSibling;

      if (!prevLengthAttr || !prevNode || prevNode.nodeType !== Node.TEXT_NODE) {
        return;
      }

      const prevLength = Number(prevLengthAttr);

      if (!Number.isFinite(prevLength)) {
        return;
      }

      const prevTextNode = prevNode as Text;
      const prevText = prevTextNode.textContent ?? '';

      if (prevText.length <= prevLength) {
        return;
      }

      const preserved = prevText.slice(0, prevLength);
      const extra = prevText.slice(prevLength);

      prevTextNode.textContent = preserved;

      const leadingMatch = extra.match(/^[\u00A0\s]+/);

      if (leadingMatch && !boldElement.hasAttribute(ATTR.LEADING_WHITESPACE)) {
        boldElement.setAttribute(ATTR.LEADING_WHITESPACE, leadingMatch[0]);
      }

      if (extra.length === 0) {
        return;
      }

      const existingContent = boldElement.textContent ?? '';
      const newContent = existingContent + extra;
      const storedLeading = boldElement.getAttribute(ATTR.LEADING_WHITESPACE) ?? '';
      const shouldPrefixLeading = storedLeading.length > 0 && existingContent.length === 0 && !newContent.startsWith(storedLeading);
      const adjustedContent = shouldPrefixLeading ? storedLeading + newContent : newContent;
      const updatedTextNode = document.createTextNode(adjustedContent);

      while (boldElement.firstChild) {
        boldElement.removeChild(boldElement.firstChild);
      }

      boldElement.appendChild(updatedTextNode);

      if (!selection?.isCollapsed || !isNodeWithin(selection.focusNode, prevTextNode)) {
        return;
      }

      const newRange = document.createRange();
      const caretOffset = updatedTextNode.textContent?.length ?? 0;

      newRange.setStart(updatedTextNode, caretOffset);
      newRange.collapse(true);

      selection.removeAllRanges();
      selection.addRange(newRange);
    });
  }
```

**Step 2: Update refreshSelectionState() in inline-tool-bold.ts**

Replace the call to `synchronizeCollapsedBold`:

```typescript
// BEFORE
BoldInlineTool.synchronizeCollapsedBold(selection);

// AFTER
CollapsedBoldManager.getInstance().synchronize(selection);
```

**Step 3: Delete synchronizeCollapsedBold() from BoldInlineTool**

Remove the entire static method `synchronizeCollapsedBold` (~lines 498-560).

**Step 4: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 5: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move synchronize() to CollapsedBoldManager"
```

---

## Task 5: Move enforceLengths() Method

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Add enforceLengths() and splitText() to CollapsedBoldManager**

```typescript
  /**
   * Enforce length limits on collapsed bold elements
   * @param selection - The current selection to determine the blok context
   */
  public enforceLengths(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor));

    if (!root) {
      return;
    }

    const tracked = root.querySelectorAll<HTMLElement>(`strong[${ATTR.COLLAPSED_LENGTH}]`);

    tracked.forEach((boldEl) => {
      const lengthAttr = boldEl.getAttribute(ATTR.COLLAPSED_LENGTH);

      if (!lengthAttr) {
        return;
      }

      const allowedLength = Number(lengthAttr);
      const currentText = boldEl.textContent ?? '';

      if (!Number.isFinite(allowedLength)) {
        return;
      }

      const shouldRemoveCurrentLength = currentText.length > allowedLength;
      const newTextNodeAfterSplit = shouldRemoveCurrentLength
        ? this.splitCollapsedBoldText(boldEl, allowedLength, currentText)
        : null;

      const prevLengthAttr = boldEl.getAttribute(ATTR.PREV_LENGTH);
      const prevLength = prevLengthAttr ? Number(prevLengthAttr) : NaN;
      const prevNode = boldEl.previousSibling;
      const previousTextNode = prevNode?.nodeType === Node.TEXT_NODE ? prevNode as Text : null;
      const prevText = previousTextNode?.textContent ?? '';
      const shouldRemovePrevLength = Boolean(
        prevLengthAttr &&
        Number.isFinite(prevLength) &&
        previousTextNode &&
        prevText.length > prevLength
      );

      if (shouldRemovePrevLength && previousTextNode) {
        const preservedPrev = prevText.slice(0, prevLength);
        const extraPrev = prevText.slice(prevLength);

        previousTextNode.textContent = preservedPrev;
        const extraNode = document.createTextNode(extraPrev);

        boldEl.parentNode?.insertBefore(extraNode, boldEl.nextSibling);
      }

      if (shouldRemovePrevLength) {
        boldEl.removeAttribute(ATTR.PREV_LENGTH);
      }

      if (selection?.isCollapsed && newTextNodeAfterSplit && isNodeWithin(selection.focusNode, boldEl)) {
        const caretRange = document.createRange();
        const caretOffset = newTextNodeAfterSplit.textContent?.length ?? 0;

        caretRange.setStart(newTextNodeAfterSplit, caretOffset);
        caretRange.collapse(true);

        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      if (shouldRemoveCurrentLength) {
        boldEl.removeAttribute(ATTR.COLLAPSED_LENGTH);
      }
    });
  }

  /**
   * Split text content exceeding the allowed collapsed bold length
   */
  private splitCollapsedBoldText(boldEl: HTMLElement, allowedLength: number, currentText: string): Text | null {
    const parent = boldEl.parentNode;

    if (!parent) {
      return null;
    }

    const preserved = currentText.slice(0, allowedLength);
    const extra = currentText.slice(allowedLength);

    boldEl.textContent = preserved;

    const textNode = document.createTextNode(extra);

    parent.insertBefore(textNode, boldEl.nextSibling);

    return textNode;
  }
```

**Step 2: Update notifySelectionChange() in inline-tool-bold.ts**

```typescript
// BEFORE
BoldInlineTool.enforceCollapsedBoldLengths(window.getSelection());

// AFTER
CollapsedBoldManager.getInstance().enforceLengths(window.getSelection());
```

**Step 3: Update refreshSelectionState() in inline-tool-bold.ts**

```typescript
// BEFORE
BoldInlineTool.enforceCollapsedBoldLengths(selection);

// AFTER
CollapsedBoldManager.getInstance().enforceLengths(selection);
```

**Step 4: Delete enforceCollapsedBoldLengths() and splitCollapsedBoldText() from BoldInlineTool**

Remove both static methods (~lines 645-720).

**Step 5: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 6: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move enforceLengths() to CollapsedBoldManager"
```

---

## Task 6: Move guardBoundaryKeydown() Method

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Add guardBoundaryKeydown() and setCaret() to CollapsedBoldManager**

Add import at top:

```typescript
import { isBoldElement } from '../utils/bold-dom-utils';
```

Add methods:

```typescript
  /**
   * Ensure caret is positioned at the end of a collapsed boundary text node
   * before the browser processes a printable keydown
   * @param event - Keydown event fired before browser input handling
   */
  public guardBoundaryKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key;

    if (key.length !== 1) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = range.startContainer as Text;
    const textContent = textNode.textContent ?? '';

    if (textContent.length === 0 || range.startOffset !== 0) {
      return;
    }

    const previousSibling = textNode.previousSibling;

    if (!isBoldElement(previousSibling)) {
      return;
    }

    if (!/^\s/.test(textContent)) {
      return;
    }

    this.setCaret(selection, textNode, textContent.length);
  }

  /**
   * Place caret at the provided offset within a text node
   */
  private setCaret(selection: Selection, node: Text, offset: number): void {
    const newRange = document.createRange();

    newRange.setStart(node, offset);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }
```

**Step 2: Update initializeGlobalListeners() in inline-tool-bold.ts**

Replace the keydown listener registration:

```typescript
// BEFORE
if (!BoldInlineTool.guardKeydownListenerRegistered) {
  document.addEventListener('keydown', BoldInlineTool.guardCollapsedBoundaryKeydown, true);
  BoldInlineTool.guardKeydownListenerRegistered = true;
}

// AFTER
if (!BoldInlineTool.guardKeydownListenerRegistered) {
  document.addEventListener('keydown', (e) => CollapsedBoldManager.getInstance().guardBoundaryKeydown(e), true);
  BoldInlineTool.guardKeydownListenerRegistered = true;
}
```

**Step 3: Delete guardCollapsedBoundaryKeydown() from BoldInlineTool**

Remove the static method (~lines 587-612).

**Step 4: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 5: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move guardBoundaryKeydown() to CollapsedBoldManager"
```

---

## Task 7: Move moveCaretAfterBoundary() and Helpers

**Files:**
- Modify: `src/components/inline-tools/services/collapsed-bold-manager.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Add moveCaretAfterBoundary() and helper methods to CollapsedBoldManager**

Add import (if not already present):

```typescript
import { findBoldElement } from '../utils/bold-dom-utils';
```

Add methods:

```typescript
  /**
   * Ensure caret is positioned after boundary bold elements when toggling collapsed selections
   * @param selection - Current selection
   */
  public moveCaretAfterBoundary(selection: Selection): void {
    if (!selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!range.collapsed) {
      return;
    }

    const activePlaceholder = findBoldElement(range.startContainer);

    if (activePlaceholder?.getAttribute(ATTR.COLLAPSED_ACTIVE) === 'true') {
      return;
    }

    if (this.moveCaretFromElementContainer(selection, range)) {
      return;
    }

    this.moveCaretFromTextContainer(selection, range);
  }

  /**
   * Adjust caret when selection container is an element adjacent to bold content
   */
  private moveCaretFromElementContainer(selection: Selection, range: Range): boolean {
    if (range.startContainer.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const element = range.startContainer as Element;
    const movedAfterPrevious = this.moveCaretAfterPreviousBold(selection, element, range.startOffset);

    if (movedAfterPrevious) {
      return true;
    }

    return this.moveCaretBeforeNextBold(selection, element, range.startOffset);
  }

  /**
   * Move caret after the bold node that precedes the caret when possible
   */
  private moveCaretAfterPreviousBold(selection: Selection, element: Element, offset: number): boolean {
    const beforeNode = offset > 0 ? element.childNodes[offset - 1] ?? null : null;

    if (!isBoldElement(beforeNode)) {
      return false;
    }

    const textNode = this.ensureFollowingTextNode(beforeNode as Element, beforeNode.nextSibling);

    if (!textNode) {
      return false;
    }

    const textOffset = textNode.textContent?.length ?? 0;

    this.setCaret(selection, textNode, textOffset);

    return true;
  }

  /**
   * Move caret before the bold node that follows the caret
   */
  private moveCaretBeforeNextBold(selection: Selection, element: Element, offset: number): boolean {
    const nextNode = element.childNodes[offset] ?? null;

    if (!isBoldElement(nextNode)) {
      return false;
    }

    const textNode = this.ensureFollowingTextNode(nextNode as Element, nextNode.nextSibling);

    if (!textNode) {
      this.setCaretAfterNode(selection, nextNode);

      return true;
    }

    this.setCaret(selection, textNode, 0);

    return true;
  }

  /**
   * Adjust caret when selection container is a text node adjacent to bold content
   */
  private moveCaretFromTextContainer(selection: Selection, range: Range): void {
    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = range.startContainer as Text;
    const previousSibling = textNode.previousSibling;
    const textContent = textNode.textContent ?? '';
    const startsWithWhitespace = /^\s/.test(textContent);

    if (
      range.startOffset === 0 &&
      isBoldElement(previousSibling) &&
      (textContent.length === 0 || startsWithWhitespace)
    ) {
      this.setCaret(selection, textNode, textContent.length);

      return;
    }

    const boldElement = findBoldElement(textNode);

    if (!boldElement || range.startOffset !== (textNode.textContent?.length ?? 0)) {
      return;
    }

    const textNodeAfter = this.ensureFollowingTextNode(boldElement, boldElement.nextSibling);

    if (textNodeAfter) {
      this.setCaret(selection, textNodeAfter, 0);

      return;
    }

    this.setCaretAfterNode(selection, boldElement);
  }

  /**
   * Position caret immediately after the provided node
   */
  private setCaretAfterNode(selection: Selection, node: Node | null): void {
    if (!node) {
      return;
    }

    const newRange = document.createRange();

    newRange.setStartAfter(node);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  /**
   * Ensure there is a text node immediately following a bold element
   */
  private ensureFollowingTextNode(boldElement: Element, referenceNode: Node | null): Text | null {
    const parent = boldElement.parentNode;

    if (!parent) {
      return null;
    }

    if (referenceNode && referenceNode.nodeType === Node.TEXT_NODE) {
      return referenceNode as Text;
    }

    const textNode = document.createTextNode('');

    parent.insertBefore(textNode, referenceNode);

    return textNode;
  }
```

**Step 2: Update refreshSelectionState() in inline-tool-bold.ts**

```typescript
// BEFORE
if (source === 'input' && selection) {
  BoldInlineTool.moveCaretAfterBoundaryBold(selection);
}

// AFTER
if (source === 'input' && selection) {
  CollapsedBoldManager.getInstance().moveCaretAfterBoundary(selection);
}
```

**Step 3: Delete moveCaretAfterBoundaryBold() and helpers from BoldInlineTool**

Remove these static methods:
- `moveCaretAfterBoundaryBold` (~lines 561-586)
- `moveCaretFromElementContainer` (~lines 566-580)
- `moveCaretAfterPreviousBold` (~lines 582-600)
- `moveCaretBeforeNextBold` (~lines 602-622)
- `moveCaretFromTextContainer` (~lines 624-655)
- `setCaret` (~lines 657-668)
- `setCaretAfterNode` (~lines 670-685)
- `ensureFollowingTextNode` (~lines 687-704)

**Step 4: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 5: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/inline-tools/services/collapsed-bold-manager.ts \
        src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): move moveCaretAfterBoundary() and helpers to CollapsedBoldManager"
```

---

## Task 8: Delete CollapsedBoldExitHandler

**Files:**
- Delete: `src/components/inline-tools/collapsed-bold-exit-handler.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts` (remove import if still present)

**Step 1: Verify no remaining imports**

Run: `yarn grep "CollapsedBoldExitHandler" src/`
Expected: No matches (or only in the file to be deleted)

**Step 2: Delete the file**

```bash
rm src/components/inline-tools/collapsed-bold-exit-handler.ts
```

**Step 3: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 4: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(bold): delete CollapsedBoldExitHandler (absorbed into CollapsedBoldManager)"
```

---

## Task 9: Update BoldNormalizationPass to Use Manager

**Files:**
- Modify: `src/components/inline-tools/services/bold-normalization-pass.ts`

**Step 1: Update isEmptyAndSafe() to use CollapsedBoldManager.isActivePlaceholder()**

Add import:

```typescript
import { CollapsedBoldManager } from './collapsed-bold-manager';
```

Update the `isEmptyAndSafe` method:

```typescript
  /**
   * Check if a <strong> element is empty and safe to remove
   */
  private isEmptyAndSafe(strong: HTMLElement): boolean {
    const isEmpty = (strong.textContent ?? '').length === 0;

    if (!isEmpty) {
      return false;
    }

    // Don't remove active collapsed bold placeholders
    if (CollapsedBoldManager.getInstance().isActivePlaceholder(strong)) {
      return false;
    }

    // Don't remove if it contains the preserved node (e.g., caret position)
    const containsPreservedNode = this.options.preserveNode && isNodeWithin(this.options.preserveNode, strong);

    return !containsPreservedNode;
  }
```

**Step 2: Run E2E tests**

Run: `yarn e2e:chrome --grep "inline tool bold"`
Expected: All bold tests PASS

**Step 3: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/inline-tools/services/bold-normalization-pass.ts
git commit -m "refactor(bold): use CollapsedBoldManager.isActivePlaceholder() in BoldNormalizationPass"
```

---

## Task 10: Cleanup and Remove Dead Code from BoldInlineTool

**Files:**
- Modify: `src/components/inline-tools/inline-tool-bold.ts`

**Step 1: Remove unused static data attribute constants**

Delete these lines (now centralized in CollapsedBoldManager):

```typescript
private static readonly DATA_ATTR_COLLAPSED_LENGTH = 'data-blok-bold-collapsed-length';
private static readonly DATA_ATTR_COLLAPSED_ACTIVE = 'data-blok-bold-collapsed-active';
private static readonly DATA_ATTR_PREV_LENGTH = 'data-blok-bold-prev-length';
private static readonly DATA_ATTR_LEADING_WHITESPACE = 'data-blok-bold-leading-ws';
```

**Step 2: Update any remaining references to use CollapsedBoldManager.ATTR**

Search for remaining usages of `DATA_ATTR_COLLAPSED_ACTIVE` or similar in the file and replace:

```typescript
// BEFORE
BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE

// AFTER
CollapsedBoldManager.ATTR.COLLAPSED_ACTIVE
```

**Step 3: Run full test suite**

Run: `yarn e2e`
Expected: All tests PASS

**Step 4: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 5: Verify file size reduction**

Run: `wc -l src/components/inline-tools/inline-tool-bold.ts`
Expected: ~300 lines (down from ~750)

**Step 6: Commit**

```bash
git add src/components/inline-tools/inline-tool-bold.ts
git commit -m "refactor(bold): remove dead code and unused constants from BoldInlineTool"
```

---

## Task 11: Final Verification

**Files:**
- All modified files

**Step 1: Run full E2E test suite across all browsers**

Run: `yarn e2e`
Expected: All tests PASS

**Step 2: Run unit tests**

Run: `yarn test`
Expected: All tests PASS

**Step 3: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 4: Verify expected file sizes**

```bash
wc -l src/components/inline-tools/inline-tool-bold.ts
wc -l src/components/inline-tools/services/collapsed-bold-manager.ts
ls src/components/inline-tools/collapsed-bold-exit-handler.ts 2>/dev/null || echo "File deleted (expected)"
```

Expected:
- `inline-tool-bold.ts`: ~300 lines
- `collapsed-bold-manager.ts`: ~400 lines
- `collapsed-bold-exit-handler.ts`: File deleted

**Step 5: Update plan status**

Update this plan file's status from "Approved" to "Complete".

**Step 6: Final commit**

```bash
git add docs/plans/2026-01-12-collapsed-bold-manager-design.md
git commit -m "docs: mark collapsed bold manager refactor as complete"
```

---

## Original Design Context

### Problem

`inline-tool-bold.ts` was ~750 lines, significantly larger than `inline-tool-italic.ts` (~280 lines) despite implementing the same conceptual formatting operation. The complexity came from sophisticated "typeahead absorption" behavior that:

1. Tracks previous text lengths
2. Absorbs characters typed before the bold element
3. Handles leading whitespace specially
4. Uses MutationObserver for real-time synchronization

This behavior is required (battle-tested), but the logic was scattered across static methods making it hard to maintain and debug.

### Solution

Created a unified `CollapsedBoldManager` singleton that consolidates all collapsed selection logic.

### File Structure (After Refactor)

```
src/components/inline-tools/services/
├── collapsed-bold-manager.ts      # NEW - unified manager (~400 lines)
├── bold-normalization-pass.ts     # UPDATED - uses manager
└── inline-tool-event-manager.ts   # UNCHANGED
```

### Expected Outcome

- `inline-tool-bold.ts`: ~750 → ~300 lines (60% reduction)
- `collapsed-bold-manager.ts`: ~400 lines (all collapsed logic)
- `collapsed-bold-exit-handler.ts`: deleted
