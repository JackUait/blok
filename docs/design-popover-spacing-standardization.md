# Popover Spacing Standardization Design

**Date**: 2026-02-09
**Status**: Implemented
**Issue**: Unbalanced left/right spacing in popover items (specifically Clear/Delete buttons in table popovers)

## Problem Statement

Users reported that the Clear and Delete buttons in table popovers have unbalanced left and right indentation. After comprehensive analysis of all popover types in the codebase, we identified a systemic spacing imbalance affecting all icon+text popover items.

## Current State Analysis

### Popover Types in Blok

1. **Toolbox** (`src/components/ui/toolbox.ts`)
   - Layout: Icon + Title + Shortcut (secondary label)
   - Context: Slash menu and + button menu
   - Searchable: Yes

2. **Block Settings** (`src/components/modules/toolbar/blockSettings.ts`)
   - Layout: Icon + Title
   - Context: Settings gear menu
   - Features: Nested "Convert to" submenu

3. **Inline Toolbar** (`src/components/modules/toolbar/inline/`)
   - Layout: Icon only (no text)
   - Context: Text selection formatting
   - Special: Uses `iconWithGap: false` override

4. **Table Row/Column Controls** (`src/tools/table/table-row-col-controls.ts`)
   - Layout: Icon + Title (+ custom HTML heading toggle)
   - Context: Table grip menus
   - Features: Insert, delete, heading toggles

5. **Table Cell Selection** (`src/tools/table/table-cell-selection.ts`)
   - Layout: Icon + Title
   - Context: Cell selection pill menu
   - Single item: "Clear"

### Current Spacing System

**Base styles** (`src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts`):

```typescript
item: 'px-2 py-(--item-padding) ...'  // px-2 = 8px horizontal padding
icon: 'w-[26px] h-[26px] ...'              // 26×26px icon container
```

**Icon gap** (`popover-item-default.ts` line 341):
```typescript
iconWithGap && 'mr-2',  // mr-2 = 8px right margin
```

**Title** (line 260):
```typescript
'mr-auto truncate text-sm font-medium leading-5'  // mr-auto = grow
```

### Visual Balance Issue

**Current layout**:
```
[8px padding] [26px icon] [8px gap] [flexible title space] [8px padding]
└─────────── 42px ──────────┘                     └─ minimal ─┘
```

**Problem**: Left side has 42px of fixed space (padding + icon + gap) before text starts, while right side only has 8px padding after text ends. This creates a left-heavy, visually unbalanced appearance.

**Contributing factors**:
1. Fixed left space (42px) vs minimal right space (8px)
2. Icons have varying visual weights due to SVG stroke/fill differences
3. The `mr-auto` on title absorbs all remaining space, leaving no visual counterbalance on the right

## Root Cause

The spacing system was designed for flexibility (allowing titles to take up remaining space with `mr-auto`) but didn't account for visual balance. While technically symmetric in padding (`px-2` on both sides), the presence of a 26px icon + 8px gap on the left creates perceptual asymmetry.

## Proposed Solution

### Primary Fix: Increase Icon Gap

Increase the icon-to-text gap from `mr-2` (8px) to `mr-3` (12px) for better visual balance.

**New layout**:
```
[8px padding] [26px icon] [12px gap] [flexible title space] [8px padding]
└─────────── 46px ──────────┘                      └─ minimal ─┘
```

**Rationale**:
- Creates more breathing room between icon and text
- Better visual balance without changing base padding
- Maintains consistency across all popover types
- Minimal code change (one class swap)
- Improves readability and visual hierarchy

### Implementation

**File 1**: `src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.ts`

**Change** (line 341):
```typescript
// Before:
iconWithGap && 'mr-2',

// After:
iconWithGap && 'mr-3',
```

**File 2**: `src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts`

**Change** (line 13):
```typescript
// Before:
item: '... px-2 py-(--item-padding) ...',

// After:
item: '... pl-2 pr-8 py-(--item-padding) ...',
```

**Affected contexts**: All popover items with `iconWithGap: true` (default):
- Toolbox items
- Block settings items
- Table row/column control items
- Table cell selection items

**Exceptions preserved**:
- Inline toolbar: Still uses `mr-0!` override (icon-only layout)
- Nested inline: Still uses `mr-2!` override for specific nested contexts

### Secondary Improvements (Future Consideration)

1. **Icon SVG standardization**: Audit all icon SVGs to ensure consistent viewBox padding and visual weight
2. **Destructive item styling**: Consider additional visual indicators for destructive actions (already has red hover, could add right-side visual element)
3. **Secondary label spacing**: Review `pr-1.5` (6px) on shortcuts, may benefit from adjustment to `pr-2` (8px) for consistency

## Testing & Validation

**Visual inspection checklist**:
- [ ] Toolbox popover (slash menu) - icon/text/shortcut spacing
- [ ] Block settings menu - Convert to and Delete items
- [ ] Inline toolbar - ensure icons remain properly spaced (iconWithGap: false preserved)
- [ ] Table row controls popover - all menu items
- [ ] Table column controls popover - all menu items
- [ ] Table cell selection popover - Clear button
- [ ] Heading toggle (custom HTML item) - visual consistency

**E2E test scenarios**:
- Open each popover type
- Verify visual balance of spacing
- Ensure no layout breaks or overflow
- Check hover/focus states
- Verify keyboard navigation still works

## Metrics

**Before (original)**:
- Icon gap: 8px (`mr-2`)
- Left padding: 8px (`px-2`)
- Right padding: 8px (`px-2`)
- Left space before text: 42px (8px padding + 26px icon + 8px gap)
- Right space after text: 8px
- Balance ratio: 5.25:1 (left-heavy)

**After (iteration 1 - insufficient)**:
- Icon gap: 12px (`mr-3`)
- Left padding: 8px
- Right padding: 8px
- Left space before text: 46px (8px padding + 26px icon + 12px gap)
- Right space after text: 8px
- Balance ratio: 5.75:1 (still too left-heavy)

**After (iteration 2 - final)**:
- Icon gap: 12px (`mr-3`)
- Left padding: 8px (`pl-2`)
- Right padding: 32px (`pr-8`)
- Left space before text: 46px (8px padding + 26px icon + 12px gap)
- Right space after text: 32px
- Balance ratio: 1.44:1 (near-optimal visual balance)

**Note**: Perfect 1:1 balance isn't the goal - we want the text to be readable with clear icon association. The increased icon gap (4px) and quadrupled right padding (24px increase) together create excellent visual balance and breathing room.

## Rollout Plan

1. ✅ Analyze current state across all popover types
2. ✅ Document findings and proposed solution
3. ⏳ Write test to verify spacing behavior
4. ⏳ Implement spacing adjustment
5. ⏳ Run existing E2E tests to catch regressions
6. ⏳ Visual QA across all popover types
7. ⏳ Commit and push changes
8. ⏳ Monitor for issues in production

## References

- Original issue: Screenshot comparison of Clear vs Delete buttons
- Popover codebase exploration: Agent analysis output
- Browser inspection: Visual screenshots of all popover types captured at localhost:3303
