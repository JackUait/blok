# Configurable Popover Width

## Problem

All popovers currently have a hardcoded width of 280px. Different popovers need different widths:

1. **Add menu (Toolbox)** - 280px (current, correct)
2. **Block settings menu / Convert to** - should be auto (fit content)
3. **Add link popover** - should be 200px

## Solution

Add a `width` property to `PopoverParams` and `PopoverItemChildren` to allow each popover to specify its width.

## Type Changes

### `types/utils/popover/popover.d.ts`

Add to `PopoverParams`:

```typescript
/**
 * Width of the popover. Defaults to '280px'.
 * Use 'auto' to fit content width.
 */
width?: string;
```

### `types/utils/popover/popover-item.d.ts`

Add to `PopoverItemChildren`:

```typescript
/**
 * Width of the nested popover. Defaults to '280px'.
 * Use 'auto' to fit content width.
 */
width?: string;
```

## Implementation Changes

### `src/components/utils/popover/popover-abstract.ts`

In `createPopoverDOM()`, change:

```typescript
popover.style.setProperty('--width', '280px');
```

To:

```typescript
popover.style.setProperty('--width', this.params.width ?? '280px');
```

### `src/components/utils/popover/popover-desktop.ts`

In `showNestedPopoverForItem()`, pass width to nested popover:

```typescript
this.nestedPopover = new PopoverDesktop({
  // ... existing params ...
  width: item.childrenWidth,
});
```

### `src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.ts`

Add getter to expose `childrenWidth` from the item's children config.

## Consumer Changes

### `src/components/modules/toolbar/blockSettings.ts`

Add `width: 'auto'` to popover params.

### `src/components/inline-tools/inline-tool-link.ts`

Add `width: '200px'` to children config.

### `src/components/ui/toolbox.ts`

No change needed - defaults to 280px.
