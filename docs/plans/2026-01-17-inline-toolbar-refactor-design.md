# InlineToolbar Refactor Design

**Date:** 2026-01-17
**Status:** Proposed
**Author:** Claude (with user approval)

## Overview

The `InlineToolbar` class ([`src/components/modules/toolbar/inline.ts`](../../src/components/modules/toolbar/inline.ts)) is currently **956 lines** with multiple distinct concerns. This design proposes extracting focused helper classes following the pattern established by the existing `Toolbar` module refactoring.

**Goals:**
- Improve testability through smaller, focused units
- Enhance maintainability by separating concerns
- Enable future feature development without increasing complexity
- No breaking changes to public API

## Current State Analysis

### Identified Concerns (by line count)

| Concern | Lines | Description |
|---------|-------|-------------|
| Shortcut Management | ~150 | Registering, tracking, and removing keyboard shortcuts |
| Keyboard Event Handling | ~55 | Arrow key handling, flipper focus state |
| Positioning | ~30 | Calculating toolbar position based on selection |
| Tools Management | ~120 | Getting available tools, creating instances |
| Selection Validation | ~85 | Complex `allowedToShow()` validation logic |
| Popover Item Building | ~90 | Converting tool render output to popover items |
| Initialization/Lifecycle | ~80 | Scheduling and retrying initialization |
| Opening/Closing State | ~60 | Managing open/close state and promises |
| Nested Popover State | ~25 | Tracking nested popover visibility |

### Existing Test Coverage

- Unit tests: [`test/unit/modules/toolbar/inline.test.ts`](../../test/unit/modules/toolbar/inline.test.ts) (~1000 lines)
- E2E tests: Multiple spec files in [`test/playwright/tests/ui/`](../../test/playwright/tests/ui/)

## Proposed Design

### Pattern: Helper Classes (following Toolbar module)

The existing `Toolbar` module uses helper classes:
- `ToolbarPositioner` - positioning calculations
- `ClickDragHandler` - click vs drag detection
- `PlusButtonHandler` - plus button behavior
- `SettingsTogglerHandler` - settings toggler behavior

`InlineToolbar` will follow the same pattern.

### File Structure

```
src/components/modules/toolbar/inline/
├── index.ts                    # Main InlineToolbar class (coordinator, ~200 lines)
├── shortcuts-manager.ts        # InlineShortcutManager (~150 lines)
├── positioner.ts               # InlinePositioner (~30 lines)
├── tools-manager.ts            # InlineToolsManager (~120 lines)
├── selection-validator.ts      # InlineSelectionValidator (~85 lines)
├── popover-builder.ts          # InlinePopoverBuilder (~90 lines)
├── keyboard-handler.ts         # InlineKeyboardHandler (~55 lines)
├── lifecycle-manager.ts        # InlineLifecycleManager (~80 lines)
├── constants.ts                # Shared constants
└── types.ts                    # Shared interfaces
```

### Test Structure

```
test/unit/modules/toolbar/inline/
├── index.test.ts               # Main coordinator tests
├── shortcuts-manager.test.ts   # Shortcut management tests
├── positioner.test.ts          # Positioning calculation tests
├── tools-manager.test.ts       # Tools retrieval and filtering tests
├── selection-validator.test.ts # Selection validation logic tests
├── popover-builder.test.ts     # Popover item building tests
├── keyboard-handler.test.ts    # Keyboard event handling tests
└── lifecycle-manager.test.ts   # Initialization scheduling tests
```

## Helper Class Specifications

### 1. InlineShortcutManager

**Responsibility:** Register and manage keyboard shortcuts for inline tools

**State:**
```typescript
private registeredShortcuts: Map<string, string>; // tool name -> shortcut
private shortcutsRegistered: boolean;
private shortcutRegistrationScheduled: boolean;
```

**Public API:**
```typescript
class InlineShortcutManager {
  constructor(
    private getBlok: () => BlokModules,
    private onShortcutPressed: (toolName: string) => Promise<void>
  ) {}

  // Try to register shortcuts (with retry scheduling)
  tryRegisterShortcuts(): void;

  // Get shortcut for a specific tool
  getShortcut(toolName: string): string | undefined;

  // Clean up shortcuts
  destroy(): void;
}
```

**Private Methods:**
- `registerInitialShortcuts(): boolean`
- `tryEnableShortcut(toolName, shortcut): void`
- `enableShortcuts(toolName, shortcut): void`
- `isShortcutTakenByAnotherTool(toolName, shortcut): boolean`
- `scheduleShortcutRegistration(): void`

**Dependencies:** `Blok.Tools`, `Blok.BlockManager`, `Blok.I18n`, `Shortcuts` utility

---

### 2. InlinePositioner

**Responsibility:** Calculate and apply inline toolbar position

**State:**
```typescript
private readonly toolbarVerticalMargin: number; // 20 (mobile) or 6 (desktop)
```

**Public API:**
```typescript
class InlinePositioner {
  constructor(options: { isMobile: boolean }) {
    this.toolbarVerticalMargin = options.isMobile ? 20 : 6;
  }

  // Calculate and apply position to wrapper element
  apply(
    wrapper: HTMLElement,
    selectionRect: DOMRect,
    wrapperOffset: DOMRect,
    contentRect: DOMRect,
    popoverWidth: number
  ): void;
}
```

**Dependencies:** Selection metrics from `SelectionUtils.rect`

---

### 3. InlineToolsManager

**Responsibility:** Get available tools and create tool instances

**Public API:**
```typescript
class InlineToolsManager {
  constructor(private getBlok: () => BlokModules) {}

  // Get tools available for current block (filtered by read-only)
  getAvailableTools(): InlineToolAdapter[];

  // Create tool instances from adapters
  createInstances(tools: InlineToolAdapter[]): Map<InlineToolAdapter, IInlineTool>;

  // Get shortcut name for a tool (delegates to internal tools)
  getToolShortcut(toolName: string): string | undefined;

  // Get all inline tools as instances
  private get inlineTools(): { [name: string]: IInlineTool };
}
```

**Dependencies:** `Blok.BlockManager`, `Blok.Tools`, `Blok.ReadOnly`

---

### 4. InlineSelectionValidator

**Responsibility:** Determine if inline toolbar should be shown based on selection

**Public API:**
```typescript
class InlineSelectionValidator {
  constructor(private getBlok: () => BlokModules) {}

  // Check if inline toolbar can be shown
  canShow(): { allowed: boolean; reason?: string };

  // Resolve selection with test mock handling
  private resolveSelection(): Selection | null;
}
```

**Validation Rules:**
- Selection must not be null
- Selection must not be collapsed
- Selected text must have content
- Target must not be IMG or INPUT tag
- Current block must exist
- At least one inline tool must be available for the block
- Target must be contenteditable (or in read-only mode with valid selection)

**Dependencies:** `Blok.BlockManager`, `Blok.ReadOnly`, `SelectionUtils`

---

### 5. InlinePopoverBuilder

**Responsibility:** Convert tool instances to popover items

**Public API:**
```typescript
class InlinePopoverBuilder {
  constructor(
    private getBlok: () => BlokModules,
    private i18n: I18nModule
  ) {}

  // Build popover items from tool instances
  async build(items: Map<InlineToolAdapter, IInlineTool>): Promise<PopoverItemParams[]>;

  // Process single popover item
  private processPopoverItem(
    item: PopoverItemParams | HTMLElement,
    toolName: string,
    toolTitle: string,
    shortcutBeautified: string | undefined,
    isFirstItem: boolean
  ): PopoverItemParams[];
}
```

**Dependencies:** `Blok.I18n`, utility functions (`beautifyShortcut`, `capitalize`, `translateToolName`)

---

### 6. InlineKeyboardHandler

**Responsibility:** Handle keyboard events for inline toolbar

**Public API:**
```typescript
class InlineKeyboardHandler {
  constructor(
    private getPopover: () => PopoverInline | null,
    private closeToolbar: () => void
  ) {}

  // Check if flipper has focus (user is navigating with keyboard)
  get hasFlipperFocus(): boolean;

  // Check if nested popover is open
  get hasNestedPopoverOpen(): boolean;

  // Close nested popover if open
  closeNestedPopover(): boolean;

  // Handle keydown event
  handle(event: KeyboardEvent): void;
}
```

**Behavior:**
- Close toolbar on Up/Down arrow (without Shift) when no flipper focus
- Prevent horizontal arrow key navigation when flipper has focus
- Show toolbar on Shift+Arrow

**Dependencies:** Reference to popover instance, close callback

---

### 7. InlineLifecycleManager

**Responsibility:** Coordinate initialization with retry logic

**Public API:**
```typescript
class InlineLifecycleManager {
  constructor(
    private getBlok: () => BlokModules,
    private initialize: () => void
  ) {}

  // Schedule initialization with retry
  schedule(): void;

  // Check if initialized
  get isInitialized(): boolean;

  // Mark as initialized
  markInitialized(): void;

  // Check if scheduling is in progress
  get isScheduled(): boolean;
}
```

**Behavior:**
- Uses `requestIdleCallback` with 2s timeout
- Falls back to `setTimeout(0)`
- Retries if UI wrapper not ready
- Guards against duplicate scheduling

---

## Refactored InlineToolbar Class

After extraction, `InlineToolbar` becomes a coordinator (~200 lines):

```typescript
export class InlineToolbar extends Module<InlineToolbarNodes> {
  // Public state (unchanged)
  public opened = false;

  // Helper instances
  private shortcutManager: InlineShortcutManager;
  private positioner: InlinePositioner;
  private toolsManager: InlineToolsManager;
  private selectionValidator: InlineSelectionValidator;
  private popoverBuilder: InlinePopoverBuilder;
  private keyboardHandler: InlineKeyboardHandler;
  private lifecycleManager: InlineLifecycleManager;

  // Remaining state
  private popover: Popover | null = null;
  private openingPromise: Promise<void> | null = null;
  private tools: Map<InlineToolAdapter, IInlineTool> = new Map();

  // Constructor
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });

    // Initialize helpers
    this.positioner = new InlinePositioner({ isMobile: isMobileScreen() });

    const getBlok = () => this.Blok;

    this.shortcutManager = new InlineShortcutManager(getBlok, (toolName) =>
      this.activateToolByShortcut(toolName)
    );
    this.toolsManager = new InlineToolsManager(getBlok);
    this.selectionValidator = new InlineSelectionValidator(getBlok);
    this.popoverBuilder = new InlinePopoverBuilder(getBlok, this.Blok.I18n);
    this.keyboardHandler = new InlineKeyboardHandler(
      () => this.popover as PopoverInline | null,
      () => this.close()
    );
    this.lifecycleManager = new InlineLifecycleManager(getBlok, () => this.initialize());

    // Setup keyboard listener
    this.setupKeyboardListener();

    // Schedule initialization
    this.lifecycleManager.schedule();
    this.shortcutManager.tryRegisterShortcuts();
  }

  // Public API (unchanged)
  public get hasNestedPopoverOpen(): boolean;
  public closeNestedPopover(): boolean;
  public get hasFlipperFocus(): boolean;
  public async tryToShow(needToClose?: boolean): Promise<void>;
  public close(): void;
  public containsNode(node: Node): boolean;
  public destroy(): void;

  // State setter (unchanged behavior, delegates to shortcut manager)
  public override set state(Blok: BlokModules) {
    super.state = Blok;
    this.shortcutManager.tryRegisterShortcuts();
  }

  // Private methods (simplified)
  private initialize(): void;
  private async open(): Promise<void>;
  private make(): void;
  private async activateToolByShortcut(toolName: string): Promise<void>;
  private invokeToolActionDirectly(toolName: string): void;
}
```

## Shared Types and Constants

### types.ts

```typescript
import type { InlineToolAdapter } from '../../../../src/components/tools/inline';
import type { InlineTool as IInlineTool } from '../../../../types';
import type { PopoverItemParams } from '../../../../src/components/utils/popover';

/**
 * Result of selection validation
 */
export interface SelectionValidationResult {
  /** Whether the inline toolbar can be shown */
  allowed: boolean;
  /** Optional reason for disallowing (useful for debugging) */
  reason?: string;
}

/**
 * Options for positioning the inline toolbar
 */
export interface InlinePositioningOptions {
  /** Wrapper element to position */
  wrapper: HTMLElement;
  /** Selection rectangle */
  selectionRect: DOMRect;
  /** Wrapper offset rectangle */
  wrapperOffset: DOMRect;
  /** Content area bounds */
  contentRect: DOMRect;
  /** Popover width */
  popoverWidth: number;
}

/**
 * Inline toolbar nodes
 */
export interface InlineToolbarNodes {
  wrapper: HTMLElement | undefined;
}
```

### constants.ts

```typescript
/**
 * Margin above/below the inline toolbar
 */
export const INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP = 6;
export const INLINE_TOOLBAR_VERTICAL_MARGIN_MOBILE = 20;
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         InlineToolbar                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  User selects text → tryToShow()                                     │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │ Selection        │    │                  │                       │
│  │ Validator        │───▶│ allowed?         │                       │
│  └──────────────────┘    └──────────────────┘                       │
│                                   │ No                              │
│                                   └──▶ return                        │
│                                   │ Yes                             │
│                                   ▼                                 │
│  ┌─────────────────────────────────────────────────────┐            │
│  │                   open()                             │            │
│  │                                                       │            │
│  │  ┌──────────────┐    ┌──────────────┐               │            │
│  │  │ Tools        │    │ Popover      │               │            │
│  │  │ Manager      │───▶│ Builder      │               │            │
│  │  └──────────────┘    └──────────────┘               │            │
│  │                             │                        │            │
│  │                             ▼                        │            │
│  │                    ┌──────────────┐                 │            │
│  │                    │ Positioner   │                 │            │
│  │                    └──────────────┘                 │            │
│  └─────────────────────────────────────────────────────┘            │
│                                                                       │
│  Keyboard Handler (independent, handles events)                      │
│  Shortcut Manager (independent, handles shortcuts)                   │
│  Lifecycle Manager (independent, handles init)                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Migration Strategy

### Phase 1: Extract Helpers (no behavior change)

1. Create directory structure: `src/components/modules/toolbar/inline/`
2. Create `types.ts` and `constants.ts`
3. Create each helper class file:
   - Copy relevant logic from InlineToolbar
   - Update to use constructor dependencies
   - Export as class
4. Update `InlineToolbar` to use helpers
5. Move original `inline.ts` → `inline/index.ts`
6. Update all imports across the codebase
7. Run existing tests to verify no regression

### Phase 2: Add Comprehensive Tests

For each helper class:
1. Create test file in `test/unit/modules/toolbar/inline/`
2. Write tests for:
   - Public methods
   - Edge cases (see below)
   - Error conditions
3. Update existing `inline.test.ts` to work with new structure

### Phase 3: Cleanup

1. Remove any redundant code
2. Run full test suite
3. Run E2E tests with `yarn build:test`

## Edge Cases to Handle

| Helper | Edge Cases |
|--------|------------|
| **ShortcutManager** | - Tools not loaded yet (retry scheduling)<br>- Duplicate shortcuts<br>- Shortcut removal on destroy<br>- Error handling in enableShortcuts |
| **Positioner** | - Popover width unknown (default to 0)<br>- Selection rect at viewport edge (prevent overflow)<br>- Mobile vs desktop margins |
| **ToolsManager** | - Current block is null<br>- No tools available<br>- Read-only mode filtering<br>- Internal tools vs custom tools |
| **SelectionValidator** | - Null selection<br>- Collapsed selection<br>- IMG/INPUT tag conflicts<br>- Block without contenteditable<br>- Read-only mode differences |
| **PopoverBuilder** | - Legacy HTMLElement render return<br>- Array of items<br>- Items with children (nested popovers)<br>- Separator after first item |
| **KeyboardHandler** | - Popover not yet created<br>- Nested popover state<br>- Flipper not initialized<br>- Event propagation |
| **LifecycleManager** | - UI wrapper not ready<br>- Multiple init attempts<br>- Race conditions<br>- requestIdleCallback unavailable |

## Testing Requirements

### Per-Helper Test Coverage

**ShortcutsManager:**
- Register shortcuts when tools available
- Retry registration when tools not ready
- Handle duplicate shortcuts (don't override)
- Remove shortcuts on destroy
- Error handling in enableShortcuts

**Positioner:**
- Calculate position correctly for various selection rects
- Prevent right edge overflow
- Handle mobile vs desktop margins
- Handle unknown popover width

**ToolsManager:**
- Return empty array when no current block
- Filter by read-only mode
- Create instances correctly
- Get shortcuts for internal tools

**SelectionValidator:**
- Return false for null selection
- Return false for collapsed selection
- Return false for empty selection
- Return false for IMG/INPUT tags
- Return false when no tools available
- Return false when block not contenteditable
- Return true when all conditions met

**PopoverBuilder:**
- Handle legacy HTMLElement returns (skip)
- Handle array returns
- Add separator after first item with children
- Include hints with title and shortcut

**KeyboardHandler:**
- Return correct flipper focus state
- Return correct nested popover state
- Close toolbar on arrow key when no focus
- Prevent horizontal arrow key action
- Show toolbar on Shift+Arrow

**LifecycleManager:**
- Schedule initialization with requestIdleCallback
- Retry when UI not ready
- Mark as initialized
- Prevent duplicate scheduling

## Summary of Changes

| Aspect | Before | After |
|--------|--------|-------|
| **File size** | 956 lines (single file) | ~200 lines (main) + ~600 lines (7 helpers) |
| **Files** | 1 file | 10 files (main + 7 helpers + types + constants) |
| **Test files** | 1 main test file | 8 test files (1 per helper + coordinator) |
| **Testability** | Hard - monolithic, private methods | Easy - each helper has public API |
| **Reusability** | None | Helpers can be reused (e.g., Positioner pattern) |
| **Cognitive load** | High - understand 956 lines | Low - focus on one helper at a time |
| **Public API** | 5 public methods/properties | **No breaking changes** - same 5 public methods/properties |
| **Dependencies** | Tangled within class | Clear, explicit via constructor injection |

## Acceptance Criteria

- [ ] All 7 helper classes created with clear single responsibilities
- [ ] InlineToolbar reduced to ~200 lines (coordinator only)
- [ ] All existing tests pass without modification (behavior preserved)
- [ ] New test files created for each helper class
- [ ] Test coverage maintained or improved
- [ ] No breaking changes to public API
- [ ] E2E tests pass with `yarn build:test && yarn e2e`
- [ ] Lint passes: `yarn lint`
- [ ] TypeScript types pass: `yarn lint:types`

## Open Questions

None at this time.
