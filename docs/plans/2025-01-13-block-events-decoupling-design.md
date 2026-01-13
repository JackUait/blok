# BlockEvents Decoupling Design

**Date**: 2025-01-13
**Status**: Draft
**Author**: Claude

## Problem

The `BlockEvents` class at [src/components/modules/blockEvents.ts](../src/components/modules/blockEvents.ts) is ~1,660 lines with mixed responsibilities, making it difficult to understand and modify safely.

## Goal

Reduce cognitive load by extracting focused composer classes, each handling a specific event domain. The main `BlockEvents` class becomes a concise routing layer.

## Proposed Structure

```
src/components/modules/blockEvents/
├── index.ts                          # Main BlockEvents class (~200 lines)
├── composers/
│   ├── __base.ts                     # Base class with Blok access
│   ├── markdownShortcuts.ts          # Markdown pattern detection & conversion
│   ├── keyboardNavigation.ts         # Arrow keys, Enter, Tab navigation
│   ├── blockSelectionKeys.ts         # Multi-select, copy/cut, indent
│   └── navigationMode.ts             # Escape-key navigation mode
└── constants.ts                      # Key maps, regex patterns
```

## Composer Details

### 1. BlockEventComposer (Base)

All composers extend this base for access to Blok modules:

```typescript
export abstract class BlockEventComposer {
  constructor(protected readonly Blok: BlokModules) {}
}
```

### 2. MarkdownShortcuts Composer

**File**: `composers/markdownShortcuts.ts` (~350 lines)

**Purpose**: Handle markdown-like text shortcuts that convert blocks to other types.

**Responsibilities**:
- Detect list shortcuts: `- `, `* `, `1. `, `[] ` patterns
- Detect header shortcuts: `#`, `##`, etc. (default and custom)
- Convert blocks using `BlockManager.replace()`
- Extract remaining HTML after shortcut pattern
- Position caret correctly after conversion
- Handle undo grouping via `YjsManager.stopCapturing()`

**Methods moved from BlockEvents**:
- `handleListShortcut()`
- `handleHeaderShortcut()`
- `matchDefaultHeaderShortcut()`
- `matchCustomHeaderShortcut()`
- `extractRemainingHtml()`
- `collectNodesToModify()`
- `getCaretOffset()`
- `setCaretAfterConversion()`

**Static constants moved**:
- `ORDERED_LIST_PATTERN`
- `CHECKLIST_PATTERN`
- `UNORDERED_LIST_PATTERN`
- `HEADER_PATTERN`

**Interface**:
```typescript
class MarkdownShortcuts extends BlockEventComposer {
  public handle(event: InputEvent): void;
}
```

### 3. KeyboardNavigation Composer

**File**: `composers/keyboardNavigation.ts` (~500 lines)

**Purpose**: Handle caret and block navigation via keyboard.

**Responsibilities**:
- Arrow keys for navigation (both horizontal and vertical)
- Enter key for block creation/splitting
- Tab key for navigating between inputs
- NBSP handling after empty inline elements
- Block merging on Backspace/Delete when at boundaries

**Methods moved from BlockEvents**:
- `enter()`
- `createBlockOnEnter()`
- `tabPressed()`
- `arrowRightAndDown()`
- `arrowLeftAndUp()`
- `backspace()` (block merging logic)
- `delete()` (block merging logic)
- `mergeBlocks()`

**Interface**:
```typescript
class KeyboardNavigation extends BlockEventComposer {
  public handleEnter(event: KeyboardEvent): void;
  public handleTab(event: KeyboardEvent): void;
  public handleArrowRightAndDown(event: KeyboardEvent): void;
  public handleArrowLeftAndUp(event: KeyboardEvent): void;
  public handleBackspace(event: KeyboardEvent): void;
  public handleDelete(event: KeyboardEvent): void;
}
```

### 4. BlockSelectionKeys Composer

**File**: `composers/blockSelectionKeys.ts` (~300 lines)

**Purpose**: Handle keyboard interactions when blocks are selected.

**Responsibilities**:
- Multi-select with Shift+Arrow keys
- Delete/Backspace of selected blocks
- Cmd+C / Cmd+X for copy/cut of selected blocks
- List indent/outdent with Tab/Shift+Tab

**Methods moved from BlockEvents**:
- `handleSelectedBlocksDeletion()`
- `handleCommandC()`
- `handleCommandX()`
- `handleSelectedBlocksIndent()`
- `canIndentSelectedListItems()`
- `canOutdentSelectedListItems()`
- `updateSelectedListItemsDepth()`
- `getListBlockDepth()`

**Interface**:
```typescript
class BlockSelectionKeys extends BlockEventComposer {
  public handleDeletion(event: KeyboardEvent): boolean;
  public handleCopy(event: ClipboardEvent): void;
  public handleCut(event: ClipboardEvent): void;
  public handleIndent(event: KeyboardEvent): boolean;
}
```

### 5. NavigationMode Composer

**File**: `composers/navigationMode.ts` (~100 lines)

**Purpose**: Handle Escape-key navigation mode.

**Responsibilities**:
- Enable navigation mode on Escape
- Navigate blocks with ArrowUp/ArrowDown
- Focus block on Enter
- Exit mode on Escape or printable key

**Methods moved from BlockEvents**:
- `handleNavigationModeKeys()`
- `handleEscapeToEnableNavigation()`

**Interface**:
```typescript
class NavigationMode extends BlockEventComposer {
  public handleEscape(event: KeyboardEvent): boolean;
  public handleKey(event: KeyboardEvent): boolean;
}
```

### 6. Constants

**File**: `constants.ts`

**Purpose**: Centralize shared constants.

**Moved from BlockEvents**:
- `KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP`
- `PRINTABLE_SPECIAL_KEYS`
- `EDITABLE_INPUT_SELECTOR`
- `LIST_TOOL_NAME`
- `HEADER_TOOL_NAME`

### 7. Refactored BlockEvents Core

**File**: `index.ts` (~200 lines)

**What remains**:
- Event routing from DOM to composers
- Common preprocessing (`beforeKeydownProcessing`)
- Coordination between composers
- Static utilities (`getKeyCode`, `isPrintableKeyEvent`)

**Structure**:
```typescript
export class BlockEvents extends Module {
  // Composer instances
  private readonly markdownShortcuts: MarkdownShortcuts;
  private readonly keyboardNavigation: KeyboardNavigation;
  private readonly blockSelectionKeys: BlockSelectionKeys;
  private readonly navigationMode: NavigationMode;

  constructor(Blok: BlokModules) {
    super(Blok);
    this.markdownShortcuts = new MarkdownShortcuts(Blok);
    this.keyboardNavigation = new KeyboardNavigation(Blok);
    this.blockSelectionKeys = new BlockSelectionKeys(Blok);
    this.navigationMode = new NavigationMode(Blok);
  }

  // Main event handlers (public API)
  public keydown(event: KeyboardEvent): void {
    // Navigation mode first
    if (this.navigationMode.handleEscape(event)) return;
    if (this.navigationMode.handleKey(event)) return;

    // Common preprocessing
    this.beforeKeydownProcessing(event);

    // Block selection deletion
    if (this.blockSelectionKeys.handleDeletion(event)) return;

    // Route to appropriate handler
    const keyCode = this.getKeyCode(event);
    switch (keyCode) {
      case keyCodes.ENTER:
        this.keyboardNavigation.handleEnter(event);
        break;
      case keyCodes.TAB:
        if (!this.blockSelectionKeys.handleIndent(event)) {
          this.keyboardNavigation.handleTab(event);
        }
        break;
      case keyCodes.DOWN:
      case keyCodes.RIGHT:
        this.keyboardNavigation.handleArrowRightAndDown(event);
        break;
      case keyCodes.UP:
      case keyCodes.LEFT:
        this.keyboardNavigation.handleArrowLeftAndUp(event);
        break;
      case keyCodes.BACKSPACE:
        this.keyboardNavigation.handleBackspace(event);
        break;
      case keyCodes.DELETE:
        this.keyboardNavigation.handleDelete(event);
        break;
    }

    // Slash commands
    if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
      this.slashPressed(event);
    }
    if (event.code === 'Slash' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commandSlashPressed();
    }
  }

  public keyup(event: KeyboardEvent): void {
    if (event.shiftKey) return;
    this.Blok.UI.checkEmptiness();
  }

  public input(event: InputEvent): void {
    this.handleSmartGrouping(event);
    this.markdownShortcuts.handle(event);
  }

  public handleCommandC(event: ClipboardEvent): void {
    this.blockSelectionKeys.handleCopy(event);
  }

  public handleCommandX(event: ClipboardEvent): void {
    this.blockSelectionKeys.handleCut(event);
  }

  // Preprocessing and utilities remain here
  public beforeKeydownProcessing(event: KeyboardEvent): void { /* unchanged */ }
  private handleSmartGrouping(event: InputEvent): void { /* unchanged */ }
  private slashPressed(event: KeyboardEvent): void { /* unchanged */ }
  private commandSlashPressed(): void { /* unchanged */ }
  private activateToolbox(): void { /* unchanged */ }
  private activateBlockSettings(): void { /* unchanged */ }
  private needToolbarClosing(event: KeyboardEvent): boolean { /* unchanged */ }
  private getKeyCode(event: KeyboardEvent): number | null { /* unchanged */ }
  private isPrintableKeyEvent(event: KeyboardEvent): boolean { /* unchanged */ }
}
```

## Implementation Strategy

Extract composers incrementally, testing after each step:

1. Create `__base.ts` and `constants.ts`
2. Extract `NavigationMode` (smallest, ~100 lines)
3. Extract `MarkdownShortcuts` (self-contained, ~350 lines)
4. Extract `BlockSelectionKeys` (clear boundaries, ~300 lines)
5. Extract `KeyboardNavigation` (largest, ~500 lines)
6. Refactor main `BlockEvents` class to use composers

## Benefits

- **Single responsibility**: Each composer handles one domain
- **Easy to locate**: Find functionality by feature, not by event type
- **Testable**: Composers can be unit tested in isolation
- **Maintainable**: Changes to navigation don't affect shortcuts
- **Incremental**: Can extract one composer at a time

## Trade-offs

- **Coupling**: Composers are coupled to Blok's module structure (acceptable for internal architecture)
- **File count**: More files, but each is smaller and more focused
