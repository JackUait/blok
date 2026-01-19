# List Tool Refactoring Design

**Date:** 2025-01-19
**Status:** Proposed
**Author:** Claude

## Problem Statement

The `ListItem` class in `src/tools/list/index.ts` is 2020 lines with 67 methods. This creates:

1. **Cognitive overload** - Too many responsibilities in one class make it hard to understand and reason about changes
2. **Testing difficulty** - Hard to test individual behaviors in isolation; too many things are coupled
3. **Extension limits** - Adding new list styles or behaviors requires touching too many methods
4. **Bug surface area** - Complex marker/depth logic causes bugs; need better isolation and verification

Currently, there are **no unit tests** for the list tool—only E2E tests. This means the complex marker calculation and depth validation logic is untested at the unit level.

## Proposed Solution

Extract focused, testable modules from the monolithic `ListItem` class using a pragmatic, incremental approach.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         ListItem                             │
│  (BlockTool interface, DOM rendering, keyboard handlers)    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────┐  ┌──────────────────────────┐    │
│  │ ListMarkerCalculator │  │  ListDepthValidator      │    │
│  ├──────────────────────┤  ├──────────────────────────┤    │
│  │ - getSiblingIndex()  │  │ - getMaxAllowedDepth()   │    │
│  │ - findGroupStart()   │  │ - getTargetDepthForMove()│    │
│  │ - formatNumber()     │  │ - isValidDepth()         │    │
│  └──────────────────────┘  └──────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    utils.ts                           │   │
│  │  - numberToLowerAlpha()  - numberToLowerRoman()      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## New File Structure

```
src/tools/list/
├── index.ts              # Main ListItem class (~800 lines, down from 2020)
├── marker-calculator.ts  # ListMarkerCalculator class (~300 lines)
├── depth-validator.ts    # ListDepthValidator class (~150 lines)
├── types.ts              # Shared types
├── utils.ts              # Number formatters (~60 lines)
└── constants.ts          # Style configs, indentation values (~40 lines)
```

## Module Specifications

### 1. `utils.ts` - Number Formatting Utilities

Pure functions for converting numbers to different ordered list formats.

**Exports:**
```typescript
export function numberToLowerAlpha(num: number): string;
export function numberToLowerRoman(num: number): string;
```

**Responsibilities:**
- Convert numbers to lowercase alphabetic (a, b, ..., z, aa, ab, ...)
- Convert numbers to lowercase roman numerals (i, ii, iii, iv, ...)

**Testing:** ~10 tests covering edge cases (1, 26, 27, etc.)

---

### 2. `marker-calculator.ts` - ListMarkerCalculator

Handles all marker-related logic for ordered lists. Pure functions given a block index and depth.

**Interface:**
```typescript
export class ListMarkerCalculator {
  constructor(private blocks: BlocksAPI) {}

  /**
   * Get the marker text for a list item at a specific position and depth
   */
  getMarkerText(blockIndex: number, depth: number, style: ListItemStyle): string;

  /**
   * Calculate the sibling index (0-based) within a consecutive list group
   */
  getSiblingIndex(blockIndex: number, depth: number, style: ListItemStyle): number;

  /**
   * Find the starting index of a list group by walking backwards
   */
  findGroupStart(blockIndex: number, depth: number, style: ListItemStyle): number;

  /**
   * Format a number based on depth (decimal, alpha, or roman)
   */
  formatNumber(number: number, depth: number): string;

  /**
   * Get the start value for a list group
   */
  getGroupStartValue(blockIndex: number, depth: number, siblingIndex: number, style: ListItemStyle): number;
}
```

**Methods extracted from ListItem:**
- `getSiblingIndex()`
- `countPrecedingListItemsAtDepth()`
- `countPrecedingListItemsAtDepthFromIndex()`
- `countPrecedingSiblingsAtDepth()`
- `countPrecedingListItemsAtDepthFromIndex()`
- `findListGroupStartIndex()`
- `findFirstListItemIndex()`
- `findFirstListItemIndexFromBlock()`
- `getOrderedMarkerText()`
- `getListStartValue()`
- `getListStartValueForBlock()`
- `getBlockStartValue()`
- `formatOrderedMarker()`
- `numberToLowerAlpha()` → moved to utils.ts
- `numberToLowerRoman()` → moved to utils.ts

**Testing:** ~30-40 tests covering:
- Sibling index calculation
- Group boundary detection
- Style boundary handling
- Start value inheritance
- Number formatting at different depths

---

### 3. `depth-validator.ts` - ListDepthValidator

Handles depth validation and hierarchy rules. Pure functions based on previous block state.

**Interface:**
```typescript
export class ListDepthValidator {
  constructor(private blocks: BlocksAPI) {}

  /**
   * Calculate the maximum allowed depth at a given block index
   * Rules: First item must be depth 0; others: maxDepth = previousListItem.depth + 1
   */
  getMaxAllowedDepth(blockIndex: number): number;

  /**
   * Calculate the target depth for a list item dropped at the given index
   */
  getTargetDepthForMove(blockIndex: number, currentDepth: number): number;

  /**
   * Validate if a depth is valid at the given position
   */
  isValidDepth(blockIndex: number, depth: number): boolean;
}
```

**Methods extracted from ListItem:**
- `calculateMaxAllowedDepth()`
- `calculateTargetDepthForPosition()`
- `getParentDepth()`

**Testing:** ~15-20 tests covering:
- First item depth validation
- Nested depth limits
- Drag-and-drop depth adjustment
- Non-list block boundaries

---

### 4. `types.ts` - Shared Types

Extract type definitions for reusability.

**Exports:**
```typescript
export type ListItemStyle = 'unordered' | 'ordered' | 'checklist';

export interface ListItemData extends BlockToolData {
  text: string;
  style: ListItemStyle;
  checked?: boolean;
  start?: number;
  depth?: number;
}

export interface ListItemConfig {
  defaultStyle?: ListItemStyle;
  styles?: ListItemStyle[];
  toolboxStyles?: ListItemStyle[];
  itemColor?: string;
  itemSize?: string;
}

interface StyleConfig {
  style: ListItemStyle;
  name: string;
  icon: string;
}
```

---

### 5. `constants.ts` - Constants

Extract static values.

**Exports:**
```typescript
export const INDENT_PER_LEVEL = 24;

export const BASE_STYLES = 'outline-none';
export const ITEM_STYLES = 'outline-none py-0.5 pl-0.5 leading-[1.6em]';
export const CHECKLIST_ITEM_STYLES = 'flex items-start py-0.5 pl-0.5';
export const CHECKBOX_STYLES = 'mt-1 w-4 mr-2 h-4 cursor-pointer accent-current';

export const PLACEHOLDER_KEY = 'tools.list.placeholder';
export const TOOL_NAME = 'list';

export const STYLE_CONFIGS: StyleConfig[] = [
  { style: 'unordered', name: 'bulletedList', icon: IconListBulleted },
  { style: 'ordered', name: 'numberedList', icon: IconListNumbered },
  { style: 'checklist', name: 'todoList', icon: IconListChecklist },
];
```

---

### 6. `index.ts` - ListItem (Refactored)

The main class becomes a coordinator, focusing on DOM rendering and the BlockTool interface.

**Retained responsibilities:**
- DOM rendering (`createItemElement`, `createStandardContent`, `createChecklistContent`, `createListMarker`)
- Lifecycle hooks (`rendered`, `moved`, `removed`) - now delegating to utilities
- Keyboard handlers (`handleKeyDown`, `handleEnter`, `handleBackspace`, `handleIndent`, `handleOutdent`)
- BlockTool interface (`render`, `save`, `validate`, `setData`, `merge`, `renderSettings`)
- Paste/conversion (`onPaste`, `detectStyleFromPastedContent`)

**Approximate size:** ~800 lines (down from 2020)

---

## Testing Strategy

### Unit Tests (`test/unit/tools/list/`)

```
utils.test.ts (~10 tests)
├── numberToLowerAlpha()
│   ├── converts 1 → "a"
│   ├── converts 26 → "z"
│   ├── converts 27 → "aa"
│   └── handles edge cases
└── numberToLowerRoman()

marker-calculator.test.ts (~30-40 tests)
├── getSiblingIndex()
│   ├── returns 0 for first item
│   ├── counts siblings at same depth
│   ├── stops at different style boundary
│   └── skips deeper items
├── findGroupStart()
├── formatNumber()
├── getMarkerText()
└── edge cases

depth-validator.test.ts (~15-20 tests)
├── getMaxAllowedDepth()
├── getTargetDepthForMove()
└── validation scenarios

index.test.ts (~20 tests)
├── render() creates correct DOM
├── save() extracts data
├── setData() updates in-place
└── delegates to utilities correctly
```

### E2E Tests

Existing E2E tests continue to validate integration:
- `test/playwright/tests/tools/list.spec.ts`
- `test/playwright/tests/tools/list-rapid-enter.spec.ts`

No changes needed—they'll pass if the unit tests pass.

---

## Implementation Phases

### Phase 1: Extract pure utilities (lowest risk)
1. Create `utils.ts` with `numberToLowerAlpha`, `numberToLowerRoman`
2. Write tests in `utils.test.ts`
3. Update `ListItem` to import from `utils.ts`
4. Verify existing E2E tests still pass

### Phase 2: Extract types and constants
1. Create `types.ts` with shared interfaces
2. Create `constants.ts` with style configs and static values
3. Update imports across all files

### Phase 3: Extract `ListMarkerCalculator`
1. Create `marker-calculator.ts` with the class
2. Move marker-related methods
3. Write comprehensive unit tests
4. Update `ListItem` to use `ListMarkerCalculator`
5. Run E2E tests

### Phase 4: Extract `ListDepthValidator`
1. Create `depth-validator.ts` with the class
2. Move depth validation methods
3. Write unit tests
4. Update `ListItem` to use `ListDepthValidator`
5. Run E2E tests

### Phase 5: Final cleanup
1. Remove unused code from `ListItem`
2. Ensure all exports are correct
3. Full test suite run

---

## Benefits

1. **Testability** - Complex marker and depth logic can be unit tested without DOM
2. **Cognitive load** - Each module has a single, clear responsibility
3. **Extensibility** - New list styles can be added by extending utilities, not modifying the main class
4. **Reliability** - Isolated, tested components reduce bug surface area
5. **Maintainability** - Smaller files are easier to navigate and understand

---

## Success Criteria

- [ ] All new unit tests pass (~75+ tests)
- [ ] All existing E2E tests continue to pass
- [ ] Main `ListItem` class reduced from 2020 to ~800 lines
- [ ] No regression in list functionality
- [ ] TypeScript compilation succeeds with no errors
