# Inline Slash Search Design

## Status: Implemented

## Overview

Enable filtering the toolbox by typing directly after "/" in the paragraph, similar to Notion's slash command behavior. When a user types `/head`, the toolbox filters to show matching tools (e.g., Heading 1-6).

## Behavior

1. User types "/" in empty paragraph → toolbox opens
2. User continues typing (e.g., "head") → paragraph shows "/head", toolbox filters to matching tools
3. Backspace updates the filter (typing `/hea` then backspace to `/he` updates results)
4. User selects a tool (Enter or click) → paragraph is replaced with the new block type

## Implementation

### Files Modified

1. **`src/components/utils/popover/popover-abstract.ts`**
   - Added base `filterItems(_query: string)` method (no-op, can be overridden)

2. **`src/components/utils/popover/popover-desktop.ts`**
   - Added `filterItems(query: string)` method that filters items by title match and calls `onSearch()`

3. **`src/components/modules/blockEvents.ts`**
   - Modified `needToolbarClosing()` to NOT close toolbar when toolbox is open (allows typing for inline search)

4. **`src/components/ui/toolbox.ts`**
   - Added `currentBlockForSearch` property to track the block being listened to
   - Added `startListeningToBlockInput()` - attaches input listener when toolbox opens
   - Added `stopListeningToBlockInput()` - removes listener and resets filter when toolbox closes
   - Added `handleBlockInput()` - extracts text after "/" from contenteditable element and calls `popover.filterItems()`
   - Modified `open()`, `close()`, and `onPopoverClose` to manage input listening

### Key Implementation Details

- The input listener is attached to the block's `holder` element
- Text is extracted from the `[contenteditable="true"]` element inside the holder (not the holder itself, which contains extra DOM elements)
- Uses `lastIndexOf('/')` to find the slash and extract the query
- Filter is case-insensitive and matches on item title substring

## Tests Added

Added 3 new E2E tests in `test/playwright/tests/ui/plus-button-slash.spec.ts`:

1. **"typing after "/" filters toolbox items"** - Verifies that typing filters the toolbox to matching items
2. **"backspace updates filter"** - Verifies that backspace updates the filter correctly
3. **"selecting filtered item creates the correct block type"** - Verifies that clicking a filtered item creates the expected block
