# Bold Tool Refactoring Design

## Overview

Refactor `inline-tool-bold.ts` (1730 lines) by extracting shared infrastructure that can be reused by other inline tools. Goals: testability, reusability, and readability.

## Current State

The bold tool mixes several concerns:
- Core bold toggling logic (wrap/unwrap text in `<strong>` tags)
- Collapsed selection handling (when cursor is at a position without selection)
- Global event listeners (selectionchange, input, beforeinput, keydown)
- DOM normalization (`<b>` to `<strong>`, nbsp cleanup, empty element removal)
- Caret/selection management (positioning cursor after operations)
- Mutation observation (watching for DOM changes)
- Toolbar integration (render method, button state updates)

Some extraction has already been done:
- `CollapsedBoldExitHandler` - handles collapsed bold exit state
- `bold-dom-utils.ts` - bold-specific DOM utilities

## File Structure

```
src/components/inline-tools/
├── inline-tool-bold.ts             # Slimmed down, uses shared infra
├── inline-tool-italic.ts           # Updated to use shared infra
├── collapsed-bold-exit-handler.ts  # Keep as-is (already extracted)
├── types.ts                        # Keep as-is
├── utils/
│   ├── bold-dom-utils.ts           # Keep as-is (bold-specific)
│   └── formatting-range-utils.ts   # NEW: generic range/selection utilities
└── services/
    └── inline-tool-event-manager.ts  # NEW: singleton event manager
```

## Component 1: Inline Tool Event Manager

A singleton that owns document-level event listeners and dispatches to registered inline tools.

### Interface

```typescript
type EventType = 'shortcut' | 'selectionchange' | 'input' | 'beforeinput';

interface InlineToolEventHandler {
  /** Called when keyboard shortcut fires (e.g., Cmd+B) */
  onShortcut?(event: KeyboardEvent, selection: Selection): void;

  /** Called on selection changes */
  onSelectionChange?(selection: Selection): void;

  /** Called after input events */
  onInput?(event: Event, selection: Selection): void;

  /** Called before input - return true to prevent default */
  onBeforeInput?(event: InputEvent, selection: Selection): boolean;

  /** Shortcut definition, e.g., { key: 'b', meta: true } */
  shortcut?: { key: string; meta?: boolean; ctrl?: boolean };

  /** Check if this handler applies to current selection context */
  isRelevant?(selection: Selection): boolean;
}

class InlineToolEventManager {
  static getInstance(): InlineToolEventManager;
  static reset(): void; // For testing

  register(toolName: string, handler: InlineToolEventHandler): void;
  unregister(toolName: string): void;
}
```

### Usage in Bold Tool

```typescript
// In constructor
InlineToolEventManager.getInstance().register('bold', {
  shortcut: { key: 'b', meta: true },
  onShortcut: (event, selection) => this.toggleBold(),
  onSelectionChange: (selection) => this.handleSelectionChange(selection),
  onInput: (event, selection) => this.handleInput(selection),
  onBeforeInput: (event) => event.inputType === 'formatBold',
  isRelevant: (selection) => this.isSelectionInsideBlok(selection),
});
```

### Responsibilities

Handles these document-level events:
- `keydown` - for shortcuts like Cmd+B, Cmd+I
- `selectionchange` - for updating toolbar state, collapsed selection sync
- `input` - for post-input normalization
- `beforeinput` - for intercepting native formatting commands like `formatBold`

The manager registers listeners once and dispatches to all registered tools that are relevant to the current selection context.

## Component 2: Formatting Range Utilities

Generic pure functions for range/selection operations that work with any inline formatting.

### Interface

```typescript
// Check if all text nodes in range have a matching ancestor
function isRangeFormatted(
  range: Range,
  predicate: (element: Element) => boolean,
  options?: { ignoreWhitespace?: boolean }
): boolean;

// Find first ancestor matching predicate
function findFormattingAncestor(
  node: Node | null,
  predicate: (element: Element) => boolean
): HTMLElement | null;

// Check if any ancestor matches predicate
function hasFormattingAncestor(
  node: Node | null,
  predicate: (element: Element) => boolean
): boolean;

// Collect all matching ancestors within a range
function collectFormattingAncestors(
  range: Range,
  predicate: (element: Element) => boolean
): HTMLElement[];

// Create a tree walker that iterates text nodes intersecting a range
function createRangeTextWalker(range: Range): TreeWalker;
```

### Usage in Bold Tool

```typescript
import { isRangeFormatted, findFormattingAncestor } from './utils/formatting-range-utils';
import { isBoldTag } from './utils/bold-dom-utils';

// Before (50 lines)
private isRangeBold(range: Range, options: { ignoreWhitespace: boolean }): boolean {
  // Complex tree walker and range intersection logic
}

// After (1 line)
private isRangeBold(range: Range, options: { ignoreWhitespace: boolean }): boolean {
  return isRangeFormatted(range, isBoldTag, options);
}
```

### Usage in Italic Tool

```typescript
import { isRangeFormatted, findFormattingAncestor } from './utils/formatting-range-utils';

const isItalicTag = (el: Element) => el.tagName === 'I' || el.tagName === 'EM';

private isRangeItalic(range: Range, options: { ignoreWhitespace: boolean }): boolean {
  return isRangeFormatted(range, isItalicTag, options);
}
```

## Refactored Bold Tool Structure

After extraction, `inline-tool-bold.ts` shrinks from ~1730 to ~600-700 lines.

### Stays in Bold Tool (~600 lines)

- `render()` - toolbar integration
- `toggleBold()` - orchestration
- `wrapWithBold()` / `unwrapBoldTags()` - core wrap/unwrap logic
- `toggleCollapsedSelection()` / `startCollapsedBold()` - collapsed caret handling
- `mergeAdjacentBold()` - bold-specific merging
- Bold-specific normalization calls (delegates to utilities)
- `isSelectionInsideBlok()` - context checking

### Moves to InlineToolEventManager (~200 lines)

- `initializeGlobalListeners()`
- `handleShortcut()`
- `handleGlobalSelectionChange()`
- `handleGlobalInput()`
- `handleBeforeInput()`
- `guardCollapsedBoundaryKeydown()`
- Static listener registration flags

### Moves to formatting-range-utils.ts (~150 lines)

- `isRangeBold()` logic becomes `isRangeFormatted()`
- `collectBoldAncestors()` logic becomes `collectFormattingAncestors()`
- Tree walker creation with range intersection logic
- Range intersection fallback for Safari

### Already Extracted (unchanged)

- `CollapsedBoldExitHandler` - handles collapsed bold exit state
- `bold-dom-utils.ts` - bold-specific DOM utilities (`isBoldTag`, `ensureStrongElement`, etc.)

## Implementation Order

1. **Create `formatting-range-utils.ts`** - pure functions, easy to test in isolation
2. **Update bold tool to use range utils** - swap out duplicated code, verify nothing breaks
3. **Update italic tool to use range utils** - confirm the abstractions work for both
4. **Create `InlineToolEventManager`** - the singleton with document listeners
5. **Update bold tool to use event manager** - remove static listener code
6. **Update italic tool to use event manager** - if italic needs shortcuts/events later

Each step is independently verifiable.

## Estimated Line Count Changes

| File | Before | After |
|------|--------|-------|
| `inline-tool-bold.ts` | 1730 | ~600 |
| `inline-tool-italic.ts` | 500 | ~350 |
| `formatting-range-utils.ts` | (new) | ~150 |
| `inline-tool-event-manager.ts` | (new) | ~200 |

Net reduction: ~930 lines removed from bold/italic, ~350 lines added in shared utilities.

## Benefits

- **Testability**: Each component can be unit tested in isolation
- **Reusability**: New inline tools (underline, strikethrough, etc.) can use the shared infrastructure
- **Readability**: Bold tool focuses on bold-specific logic, not event plumbing
- **Single responsibility**: Event management, range utilities, and formatting logic are separated
