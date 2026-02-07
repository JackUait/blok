# Popover Registry: Unified Popover Lifecycle

## Problem

Popover behavior is scattered across 4 locations with 4 different strategies:

| Behavior | Toolbox/BlockSettings | Inline Toolbar | Table Grips |
|---|---|---|---|
| Click outside | Global `click.ts` handler | Global `click.ts` + selection change | Manual `pointerdown` listener |
| Escape | Central keyboard controller (priority cascade) | Central keyboard controller | **Not handled** |
| Positioning | `PopoverDesktop.calculatePosition()` | Separate `positioner.ts` | `PopoverDesktop.calculatePosition()` |

Adding a new popover requires touching 3 separate files and knowing about the implicit priority system. Table grips don't get Escape handling. The keyboard controller has an 80-line hard-coded cascade that checks each popover type by name.

## Scope

Unify vertical popovers only: Toolbox, BlockSettings, Table Grips. InlineToolbar stays as-is (it's fundamentally different: horizontal, selection-anchored, different keyboard constraints).

## Design

### PopoverRegistry

A singleton stack that tracks open popovers:

```typescript
class PopoverRegistry {
  private stack: Array<{ popover: PopoverAbstract; options: PopoverRegistryOptions }> = [];

  register(popover: PopoverAbstract, options: PopoverRegistryOptions): void {
    // Close all non-ancestor popovers (only one popover at a time)
    for (const existing of [...this.stack]) {
      if (!this.isAncestor(existing.popover, popover)) {
        existing.popover.hide();
      }
    }
    this.stack.push({ popover, options });
  }

  unregister(popover: PopoverAbstract): void {
    this.stack = this.stack.filter(entry => entry.popover !== popover);
  }

  closeTopmost(): boolean {
    const top = this.stack.at(-1);
    if (top) {
      top.popover.hide();
      return true;
    }
    return false;
  }

  hasOpenPopovers(): boolean {
    return this.stack.length > 0;
  }
}
```

### Click-Outside Dismissal

Single `pointerdown` listener on `document`:

```typescript
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Node;
  for (const { popover, options } of [...this.stack].reverse()) {
    if (popover.hasNode(target)) return;                          // inside popover
    if (options.triggerElement?.contains(target)) return;          // on trigger
    popover.hide();                                                // outside → close
  }
});
```

Edge cases handled:
- **Click trigger while open**: Registry skips (trigger excluded), trigger's own handler manages toggle
- **Nested popover open, click outside all**: Both close top-to-bottom
- **Nested popover open, click inside parent**: Only nested closes
- **Two independent popovers**: Opening one closes the other via `register()`

### Escape Key

Keyboard controller replaces 80-line cascade with:

```typescript
if (registry.hasOpenPopovers()) {
  registry.closeTopmost();
  return;
}
// ...rest of non-popover Escape handling (navigation mode, block selection)
```

### Integration Points

Registration happens automatically in `PopoverAbstract`:
- `show()` → `PopoverRegistry.register(this, options)`
- `hide()` → `PopoverRegistry.unregister(this)`

Consumers pass options via existing `PopoverParams`:
- `triggerElement` — already exists as `trigger` in PopoverParams
- `closeOnOutsideClick` — default true

## Files Changed

| File | Change |
|---|---|
| **New: `src/components/utils/popover/popover-registry.ts`** | ~60 lines. Stack, register/unregister, pointerdown listener, closeTopmost |
| **`src/components/utils/popover/popover-abstract.ts`** | `show()` calls `registry.register(this)`, `hide()` calls `registry.unregister(this)` |
| **`src/components/modules/uiControllers/controllers/keyboard.ts`** | Replace popover-specific cascade (~80 lines) with `registry.closeTopmost()` (~5 lines) |
| **`src/components/modules/uiControllers/handlers/click.ts`** | Remove BlockSettings-specific close logic (registry handles it) |
| **`src/tools/table/table-row-col-controls.ts`** | Delete `addOutsideClickListener`/`removeOutsideClickListener` (~30 lines) |

**Net: ~60 lines added, ~110 lines removed.**

## Benefits

- Table grips get Escape handling for free
- Future popovers get click-outside + Escape for free
- No more touching keyboard controller or click handler when adding popovers
- Single source of truth for "what's open"

## Out of Scope

- InlineToolbar (horizontal, selection-anchored, different keyboard constraints)
- Positioning logic (already shared via `PopoverDesktop`)
- Flipper/keyboard navigation within popovers (already works)
- Mobile popovers (same lifecycle, just different rendering)
