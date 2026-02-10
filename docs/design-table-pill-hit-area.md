# Table Pill Button Hit Area Expansion

**Date:** 2026-02-10
**Status:** Approved
**Type:** UX Enhancement

## Problem

Both grip pills (row/col controls) and the cell selection pill have a 4px visual size in their idle state, making them difficult to target with the cursor. Users must "pixel hunt" to find the clickable area, resulting in an unresponsive feel.

## Solution

Expand the interactive hit area to 16px (matching the hover/expanded size) while keeping the visual appearance at 4px. This creates an invisible "halo" around each pill that triggers the hover state and accepts clicks.

## Implementation Strategy

Use **padding with negative margin** to expand the hit area without affecting layout positioning.

### Why This Approach?

- Keeps all existing positioning logic intact (no changes to `top`/`left` calculations)
- Expands the clickable area symmetrically around the pill
- Works with existing `mouseenter`/`mouseleave` event handlers
- Doesn't require wrapper elements or pseudo-elements
- Simpler than alternatives (wrappers, pseudo-elements)

### Technical Details

For a pill with 4px visual width and 16px desired hit area:
- Add `padding`: 6px (total size: 4px + 6px + 6px = 16px)
- Add `margin`: -6px (pulls element back to original position)
- Use `box-sizing: content-box` (so padding doesn't shrink visual pill)

The existing `translate(-50%, -50%)` centering accounts for total element size, so positioning is preserved.

## Affected Components

### 1. Row/Column Grips (`src/tools/table/table-row-col-controls.ts`)

**Col pills:** 24px × 4px visual → 24px × 16px hit area
- Add vertical padding/margin in `createGripElement()`

**Row pills:** 4px × 20px visual → 16px × 20px hit area
- Add horizontal padding/margin in `createGripElement()`

### 2. Cell Selection Pill (`src/tools/table/table-cell-selection.ts`)

**Pill:** 4px × 20px visual → 16px × 20px hit area
- Add horizontal padding/margin in `createPill()`

## Code Changes

### Row grips (4px width → 16px hit area):
```typescript
grip.style.paddingLeft = '6px';
grip.style.paddingRight = '6px';
grip.style.marginLeft = '-6px';
grip.style.marginRight = '-6px';
```

### Col grips (4px height → 16px hit area):
```typescript
grip.style.paddingTop = '6px';
grip.style.paddingBottom = '6px';
grip.style.marginTop = '-6px';
grip.style.marginBottom = '-6px';
```

### Cell selection pill (4px width → 16px hit area):
```typescript
pill.style.paddingLeft = '6px';
pill.style.paddingRight = '6px';
pill.style.marginLeft = '-6px';
pill.style.marginRight = '-6px';
```

## Edge Cases Validated

1. **No Overlapping Hit Areas**
   - Row grip at 16px width + padding won't overlap with table content
   - Col grip at 16px height + padding won't overlap with adjacent rows
   - Cell selection pill is positioned at selection edge, no overlap

2. **Drag Threshold Preserved**
   - Drag detection uses 10px threshold (`DRAG_THRESHOLD`)
   - Measured from pointer movement, not element size
   - No changes needed to drag logic

3. **Transform/Positioning Unchanged**
   - All pills use `transform: translate(-50%, -50%)`
   - Transform accounts for total element size including padding
   - Negative margins offset padding, preserving position

4. **Visual Expansion on Hover**
   - `expandGrip()` and `expandPill()` set explicit width/height
   - Existing values remain correct (padding is separate)

## Testing Strategy

- **Manual testing:** Verify hit areas feel responsive, no pixel hunting
- **Visual testing:** Confirm pills still appear 4px in idle state
- **Interaction testing:** Hover expansion, click, and drag work smoothly
- **E2E tests:** Existing tests continue passing (use `data-blok-testid`, not pixel coords)

## Alternatives Considered

### Wrapper Elements
❌ Rejected: Adds DOM complexity, risks breaking event delegation

### Pseudo-elements (::before/::after)
❌ Rejected: Requires complex `pointer-events` management, harder to reason about

### Larger Visual Size (8px or 12px idle)
❌ Rejected: Changes design aesthetic, user preferred invisible expansion

### Large Hit Area (24px)
❌ Rejected: Risk of accidental activation, user preferred medium (16px)

## Constraints Respected

- ✅ Visual design stays identical (4px pills in idle state)
- ✅ No changes to positioning calculations
- ✅ No changes to drag/drop logic
- ✅ Existing event handlers continue working
- ✅ No new DOM elements added

## Expected Outcomes

- ✅ Pills feel responsive, no pixel hunting required
- ✅ Hover state discovered naturally when approaching pill
- ✅ Visual appearance unchanged
- ✅ No regressions in existing functionality
- ✅ All tests continue passing
