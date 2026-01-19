# SelectionUtils Refactor Design

**Status:** Approved
**Date:** 2026-01-19
**Author:** Claude Code

## Problem Statement

The `SelectionUtils` class in `src/components/selection.ts` is 1139 lines with multiple concerns:

1. Static Selection API (~250 lines) - Browser Selection wrappers
2. Fake Background System (~400 lines) - Creating/removing fake selection highlights
3. Instance-based State (~100 lines) - Save/restore functionality
4. DOM Navigation (~150 lines) - Finding parent tags, expanding selections
5. Cursor Management (~150 lines) - Setting cursor positions
6. Fake Cursor (~80 lines) - Adding/removing fake cursor elements

This violates Single Responsibility Principle, makes testing difficult, and reduces maintainability.

## Goals

1. **Reliability:** Break complex logic into testable units
2. **Extensibility:** Make it easier to modify/extend individual features
3. **Maintainability:** Clear separation of concerns with focused modules
4. **Backward Compatibility:** All existing usage of `SelectionUtils` continues to work

## Architecture

**Approach:** Functional Decomposition with Facade Pattern

Create focused utility modules for each concern, keeping `SelectionUtils` as a backward-compatible facade that delegates to the appropriate modules.

### Module Structure

```
src/components/selection/
├── index.ts              # SelectionUtils facade (backward compatible)
├── core.ts               # Browser Selection wrappers
├── cursor.ts             # Cursor positioning
├── navigation.ts         # Parent tag finding, selection expansion
├── fake-cursor.ts        # Fake cursor management
└── fake-background/
    ├── index.ts          # FakeBackgroundManager class
    ├── text-nodes.ts     # Text node utilities
    ├── wrappers.ts       # Highlight wrapper creation and splitting
    ├── shadows.ts        # Box-shadow calculations
    └── types.ts          # Internal types
```

### Module Responsibilities

**core.ts** - Browser Selection wrappers (all static, stateless):
- Static getters for Selection properties (`anchorNode`, `anchorOffset`, `isCollapsed`, etc.)
- Core Selection operations (`get()`, `getRange()`, `text`, `rect`)
- Blok zone checking (`isSelectionAtBlok`, `isRangeAtBlok`)

**cursor.ts** - Cursor positioning (mostly stateless):
- `setCursor()` - Set focus to contenteditable or native input
- `isRangeInsideContainer()` - Check if range exists and belongs to container
- `collapseToEnd()` - Collapse current selection

**navigation.ts** - DOM navigation for selections:
- `findParentTag()` - Look ahead to find passed tag from current selection
- `expandToTag()` - Expand selection range to passed parent node

**fake-cursor.ts** - Fake cursor management:
- `addFakeCursor()` - Add fake cursor to current range
- `removeFakeCursor()` - Remove fake cursor from container
- `isFakeCursorInsideContainer()` - Check if element contains fake cursor

**fake-background/index.ts** - FakeBackgroundManager class:
- `setFakeBackground()` - Wrap selected text in highlight spans
- `removeFakeBackground()` - Unwrap highlights and restore selection
- `clearFakeBackground()` - Clear all fake background state
- `removeOrphanedFakeBackgroundElements()` - Clean up orphaned elements

**fake-background/text-nodes.ts** - Text node utilities:
- `collectTextNodes()` - Collect text nodes intersecting with range
- `findLineBreakPositions()` - Find positions where line breaks occur
- `splitTextAtPositions()` - Split text content at given positions

**fake-background/wrappers.ts** - Wrapper creation and processing:
- `wrapRangeWithHighlight()` - Wrap range with highlight span
- `postProcessHighlightWrappers()` - Split multi-line spans
- `splitMultiLineWrapper()` - Split multi-line wrapper into separate spans

**fake-background/shadows.ts** - Box-shadow calculations:
- `applyBoxShadowToWrapper()` - Apply box-shadow to single wrapper
- `applyLineHeightExtensions()` - Apply extensions to fill gaps between spans
- `calculateLineTopExtension()` - Calculate top extension for a line
- `calculateLineBottomExtension()` - Calculate bottom extension for a line
- `buildBoxShadow()` - Build box-shadow CSS value
- `collectAllLineRects()` - Collect all line rectangles from spans
- `groupRectsByLine()` - Group rectangles by visual line

**fake-background/types.ts** - Internal types:
```typescript
interface LineRect { top: number; bottom: number; span: HTMLElement }
interface LineGroup { top: number; bottom: number }
```

### Updated SelectionUtils Facade

The existing `SelectionUtils` class becomes a thin facade:

```typescript
export class SelectionUtils {
  // Instance state (for save/restore)
  public instance: Selection | null = null;
  public selection: Selection | null = null;
  public savedSelectionRange: Range | null = null;

  // Fake background manager instance
  private fakeBackgroundManager: FakeBackgroundManager;
  public isFakeBackgroundEnabled = false;

  constructor() {
    this.fakeBackgroundManager = new FakeBackgroundManager(this);
  }

  // Static getters delegate to core module
  public static get anchorNode(): Node | null { return core.getAnchorNode(); }
  // ... (all other static getters)

  // Static methods delegate to appropriate modules
  public static get(): Selection | null { return core.get(); }
  public static setCursor(...): DOMRect { return cursor.setCursor(...); }
  // ... (all other static methods)

  // Instance methods delegate to FakeBackgroundManager
  public setFakeBackground(): void { this.fakeBackgroundManager.setFakeBackground(); }
  public removeFakeBackground(): void { this.fakeBackgroundManager.removeFakeBackground(); }
}
```

## Data Flow

### Fake Background Flow

```
User calls SelectionUtils.setFakeBackground()
    ↓
FakeBackgroundManager.setFakeBackground()
    ↓
1. Remove any existing fake background (cleanup)
2. Get current Selection from core.get()
3. Collect text nodes via collectTextNodes()
4. For each text node:
   - Calculate segment range
   - Wrap via wrapRangeWithHighlight()
   - Collect wrapper in array
5. Post-process wrappers via postProcessHighlightWrappers()
   - Split multi-line wrappers via splitMultiLineWrapper()
6. Apply box shadows via applyLineHeightExtensions()
7. Save range to SelectionUtils.savedSelectionRange
8. Update browser Selection to span the fake background
9. Set SelectionUtils.isFakeBackgroundEnabled = true
```

## Error Handling

1. **Graceful degradation** - Functions return early or return `null` on edge cases
2. **No exceptions thrown** - All functions handle null/undefined cases internally
3. **Defensive checks** - Always check parentNode exists, use optional chaining
4. **DOM safety** - Normalize text nodes after DOM modifications

## State Management

- `savedSelectionRange` is owned by SelectionUtils instance
- FakeBackgroundManager receives reference to SelectionUtils to read/write it
- All other modules are stateless

## Testing Strategy

### Test Structure

```
test/unit/components/selection/
├── core.test.ts              # Test Selection getters and basic operations
├── cursor.test.ts            # Test cursor positioning
├── navigation.test.ts        # Test findParentTag, expandToTag
├── fake-cursor.test.ts       # Test fake cursor add/remove/check
├── fake-background/
│   ├── text-nodes.test.ts    # Test text node collection and splitting
│   ├── wrappers.test.ts      # Test wrapper creation and multi-line splitting
│   └── shadows.test.ts       # Test box-shadow calculations
└── index.test.ts             # Test SelectionUtils facade integration
```

### Testing Approach

1. **DOM-heavy modules (core, cursor, fake-cursor)**: Use jsdom with real DOM elements
2. **Pure functions (text-nodes, some shadows functions)**: Test with minimal DOM setup
3. **Complex visual logic (shadows, wrappers)**: Test with pre-configured DOM fixtures
4. **Facade (index.test.ts)**: Verify delegation and backward compatibility

### Key Test Scenarios

- `core.test.ts`: Verify `isAtBlok` correctly identifies selections inside/outside editor zones
- `cursor.test.ts`: Test cursor positioning in native inputs vs contenteditable
- `text-nodes.test.ts`: Test line break detection with various text lengths
- `shadows.test.ts`: Verify box-shadow calculations with different line-heights

## Backward Compatibility

All existing code using `SelectionUtils.methodName()` continues to work unchanged:

- Static methods delegate to new modules
- Instance state (`savedSelectionRange`, `isFakeBackgroundEnabled`) stays on SelectionUtils
- Public API surface is identical

## Implementation Notes

1. **Copy tests first** - Current `selection.test.ts` (if exists) should be reviewed for existing test coverage
2. **TDD approach** - Write tests for each module before implementing
3. **One module at a time** - Implement and test each module before moving to the next
4. **Facade last** - Implement SelectionUtils facade after all modules are complete
5. **Incremental migration** - Can migrate piece by piece, keeping old code until facade is ready
