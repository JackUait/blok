# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Blok is a headless, block-based rich text editor (similar to Notion) built for developers. Content is structured as JSON blocks rather than raw HTML, enabling clean data extraction and rendering across platforms.

## Development Commands

### Building and Development
```bash
yarn serve          # Dev server with hot reload
yarn build          # Production build to dist/
yarn build:test     # Test build (used by E2E tests)
```

### Linting and Type Checking
```bash
yarn lint           # Runs ESLint + TypeScript type checking (both must pass)
yarn lint:fix       # Auto-fix ESLint issues
yarn lint:types     # TypeScript type checking only
```

### Testing
```bash
# Unit tests (Vitest)
yarn test           # Run all unit tests
yarn test:watch     # Watch mode for unit tests
yarn test:coverage  # Unit tests with coverage report

# E2E tests (Playwright)
yarn e2e            # Run all E2E tests (all browsers)
yarn e2e:chrome     # Chromium only
yarn e2e:firefox    # Firefox only
yarn e2e:safari     # WebKit/Safari only
yarn e2e:ui         # Playwright UI mode for debugging tests
yarn e2e:ui:chrome  # UI mode with Chromium only
```

**Important**: E2E tests load the actual editor bundle from `dist/`. If you modify core code, run `yarn build:test` before running E2E tests to avoid testing stale code.

### Running a Single Test
```bash
# Single unit test file
yarn test src/components/utils/dom.test.ts

# Single E2E test file
yarn e2e test/playwright/tests/modules/blockManager.spec.ts

# Single test by name pattern
yarn e2e -g "should move block down"
```

### Storybook
```bash
yarn storybook        # Start Storybook dev server
yarn storybook:build  # Build static Storybook
yarn storybook:test   # Run Storybook tests
```

## High-Level Architecture

### Initialization Flow

Entry point: `src/blok.ts` exports the `Blok` class.

1. User creates `new Blok({ holder, tools, data, ... })`
2. Blok constructor instantiates `Core` (`src/components/core.ts`)
3. Core bootstraps the editor through phases:
   - **Configuration**: Validates config, sets defaults
   - **Initialization**: Constructs all module instances
   - **Start**: Prepares modules sequentially (Tools, UI, BlockManager, Paste, etc.)
   - **Render**: Renders initial blocks via Renderer module
   - **Ready**: Resolves `isReady` promise, enables interactions

### Module System

All editor functionality is split into discrete **modules** that extend the `Module` base class (`src/components/__module.ts`). Modules are singletons instantiated by Core and communicate via:

- **EventsDispatcher**: Typed event bus for inter-module communication
- **Module State**: Each module can access others via `this.Blok.ModuleName`

Key modules (in `src/components/modules/`):

- **BlockManager**: Creates/deletes/reorders blocks, manages the block collection
- **UI**: Creates DOM structure, event delegation
- **Toolbar**: Plus button (+) and settings toggler (☰) that follow blocks
- **Toolbox**: The "slash menu" - displays available block tools
- **InlineToolbar**: Text formatting toolbar (bold, italic, link)
- **BlockSettings**: Block-specific settings menu (accessed via ☰)
- **DragManager**: Pointer-based drag & drop for reordering blocks
- **Caret**: Text cursor position management
- **Saver**: Extracts editor data as JSON
- **Renderer**: Renders blocks from JSON data
- **History**: Undo/redo functionality
- **Paste**: Clipboard operations
- **API**: Public API exposed to users and tools

### Block System

**Block Class** (`src/components/block/index.ts`):

Blocks are the fundamental unit. Each block:
- Wraps a Tool instance (Paragraph, Header, List, etc.)
- Has a unique `id` (via nanoid)
- Stores data in `lastSavedData`
- Supports hierarchical relationships via `parentId` and `contentIds` (Notion-like model)
- Has lifecycle hooks: `rendered()`, `updated()`, `removed()`, `moved()`
- Tracks mutations via MutationObserver
- Can be made draggable and selectable

DOM structure: `holder` (wrapper) → `contentElement` → `toolRenderedElement`

### Tool Architecture

Tools are wrapped in adapter classes that handle common concerns:

1. **BaseToolAdapter** (`src/components/tools/base.ts`) - abstract base for all adapters
2. **BlockToolAdapter** (`src/components/tools/block.ts`) - wraps block tools
3. **InlineToolAdapter** (`src/components/tools/inline.ts`) - for inline formatting
4. **BlockTuneAdapter** (`src/components/tools/tune.ts`) - for block-level actions

**Tool Factory** (`src/components/modules/tools.ts`):
- Validates and prepares tools from config
- Handles internal tools (Paragraph, Header, List, Stub, inline tools, tunes)
- Creates ToolsCollection organized by type

**Creating a Custom Tool**:

Tools implement the `BlockTool` interface (`types/tools/block-tool.d.ts`):

```typescript
class MyTool {
  static get toolbox() {
    return { title: 'My Tool', icon: '<svg>...</svg>' };
  }

  render() {
    return document.createElement('div'); // Return HTMLElement
  }

  save(blockContent) {
    return { text: blockContent.textContent }; // Extract data
  }

  validate(savedData) {
    return savedData.text.length > 0; // Optional validation
  }

  // Optional lifecycle hooks
  rendered() { }
  updated() { }
  removed() { }
  moved() { }
}
```

See bundled tools in `src/tools/` for examples: `paragraph/`, `header/`, `list/`.

### Drag & Drop Implementation

**DragManager** (`src/components/modules/dragManager.ts`):

- **Pointer-based** (not HTML5 drag API) for full cursor control
- Initiated from the settings toggler (☰ icon) on blocks
- Flow:
  1. mousedown: track start position, create preview element
  2. mousemove: show preview following cursor, find drop target, show drop indicator
  3. mouseup: call `BlockManager.move()` to reorder blocks
- Features: drag threshold (5px), auto-scroll near edges, visual drop zones

### Slash Menu (Toolbox)

**Toolbox** (`src/components/ui/toolbox.ts`):

The "slash menu" is triggered by:
1. Clicking the Plus Button (+) in the Toolbar, or
2. Typing "/" in an empty paragraph

Architecture:
- Uses the **Popover** component (`src/components/utils/popover/`) for rendering
- Displays BlockTools that have a `toolbox` config
- Has search/filter functionality
- Keyboard navigation via Flipper utility
- On tool selection: BlockManager inserts new block at current position

The Popover system is reusable - also used by BlockSettings and InlineToolbar.

## Code Conventions

### TypeScript Rules

**CRITICAL**: Never use `@ts-ignore`, `any`, or `!` assertions. Fix type errors properly with type guards and narrowing. This is enforced by the "Fix Problems Policy" in `.cursor/rules/fix-problems.mdc`.

- Import types with `type` keyword: `import type { BlokConfig } from '../../types'`
- Module classes extend `Module<T>` base class
- Use precise types, type guards, and proper error handling

### DOM Utilities

- Use `$` from `./components/utils/dom` for DOM operations (jQuery-like API)
- Use utilities from `./components/utils/` for general helpers
- CSS selectors use constants from `src/components/constants.ts`

### Data Attributes

Uses `data-blok-*` attributes for behavior/testing (not CSS classes):
- `data-blok-element` - identifies editor elements
- `data-blok-selected` - marks selected blocks
- `data-blok-tool` - identifies tool type
- `data-blok-testid` - for E2E tests

### Styling

- Uses **Tailwind CSS** utility classes exclusively
- `twMerge` and `twJoin` from `tailwind-merge` for combining classes
- Custom breakpoints: `mobile:`, `not-mobile:`, `can-hover:`
- Design system configured in `tailwind.config.js`

### Testing Best Practices

This section covers common mistakes to avoid when writing tests. These rules prevent the most frequent errors.

#### Section 1: Critical Rules (The "Never Do This" List)

**E2E Test Critical Rules:**

1. **ALWAYS run `yarn build:test` after modifying core code** - E2E tests load the bundle from `dist/`, not source files. Testing without rebuilding means testing stale code.

2. **NEVER use CSS class selectors** - Use semantic locators (`page.getByRole()`, `page.getByText()`) or `data-blok-testid` attributes. CSS classes are for styling and can change.

3. **NEVER forget async/await** - Playwright actions are asynchronous. Missing `await` causes flaky tests and race conditions.

4. **NEVER assume elements are immediately available** - Use Playwright's built-in waiting (`waitFor`, `waitForSelector`) or rely on auto-waiting from semantic locators.

**Unit Test Critical Rules:**

1. **NEVER use `@ts-ignore`, `any`, or `!` assertions** - This is enforced project-wide. Use proper type guards and narrowing.

2. **ALWAYS call `vi.clearAllMocks()` in `beforeEach`** - Prevents test pollution where mocks from one test affect another.

3. **NEVER mock what you're testing** - Only mock dependencies, not the unit under test. If you need to mock the thing you're testing, you're testing the wrong thing.

4. **ALWAYS restore mocks in `afterEach`** - Use `vi.restoreAllMocks()` to prevent mock leakage between test files.

**Architectural Rules:**

1. **Test behavior, not implementation** - Don't test private methods or internal state. Test through public APIs and observable outcomes.

2. **NEVER bypass the module system** - Don't access internal properties directly. Use the public API or events system.

3. **NEVER test multiple concerns in one test** - Each test should verify one behavior. Multiple assertions are fine if they verify the same behavior.

#### Section 2: Unit Test Patterns

**Mocking Blok Modules:**

The correct pattern for mocking modules in unit tests (see `test/unit/blok.test.ts` for reference):

```typescript
// CORRECT: Mock before imports
vi.mock('../../src/components/core', () => {
  const mockModuleInstances = {
    API: { methods: { /* ... */ } },
    Toolbar: {},
    // ... other modules
  };

  class MockCore {
    public moduleInstances = mockModuleInstances;
    public isReady = Promise.resolve();
  }

  return { Core: MockCore, mockModuleInstances };
});

// Import AFTER mocks are set up
import { Blok } from '../../src/blok';
```

**WRONG patterns:**
- Importing before mocking (hoisting issues)
- Not exporting mock instances for test access
- Forgetting to reset mock implementations in `beforeEach`

**Creating Test Fixtures:**

Use factory functions for creating test data (see `test/unit/components/modules/blockManager.test.ts`):

```typescript
// CORRECT: Factory function with sensible defaults
const createBlockStub = (options: { id?: string; name?: string } = {}): Block => {
  return {
    id: options.id ?? `block-${Math.random()}`,
    name: options.name ?? 'paragraph',
    holder: document.createElement('div'),
    // ... other required properties
  } as unknown as Block;
};

// WRONG: Hardcoded test data scattered throughout tests
// WRONG: Missing required properties causing runtime errors
```

**Testing Async Operations:**

```typescript
// CORRECT: Proper async/await handling
it('saves block data', async () => {
  const block = createBlockStub();
  await blockManager.update(block, { text: 'Updated' });
  expect(block.save).toHaveBeenCalled();
});

// WRONG: Missing await (test completes before assertion runs)
// WRONG: Not returning promises from test functions
```

#### Section 3: E2E Test Patterns

**Page Setup and Teardown:**

```typescript
// CORRECT: Proper setup with resetBlok helper
const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    // ... recreate holder
  }, { holder: HOLDER_ID });
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

// WRONG: Not cleaning up previous instances
// WRONG: Not waiting for Blok to be available
```

**Locator Strategy (Priority Order):**

1. **Role-based:** `page.getByRole('button', { name: 'Submit' })`
2. **Text-based:** `page.getByText('Hello World')`
3. **Test ID:** `page.getByTestId('block-settings')`  (uses `data-blok-testid`)
4. **NEVER:** CSS class selectors like `.blok-block` or `[class*="block"]`

```typescript
// CORRECT: Semantic locators
await page.getByRole('button', { name: 'Add Block' }).click();
await page.getByTestId('settings-toggler').click();

// WRONG: Fragile CSS selectors
await page.locator('.ce-toolbar__plus').click();
await page.locator('[class*="settings"]').click();
```

**Testing Custom Tools:**

```typescript
// CORRECT: Inject tool via classCode for dynamic evaluation
const CUSTOM_TOOL = `(() => {
  return class CustomTool {
    static get toolbox() {
      return { icon: '', title: 'Custom' };
    }
    render() {
      return document.createElement('div');
    }
    save(element) {
      return { text: element.innerHTML };
    }
  };
})();`;

await createBlok(page, {
  tools: {
    custom: { classCode: CUSTOM_TOOL }
  }
});

// WRONG: Trying to pass class instances through page.evaluate
// WRONG: Using className for tools not available globally
```

**Handling Async State:**

```typescript
// CORRECT: Wait for editor to be ready
await page.evaluate(async () => {
  await window.blokInstance.isReady;
});

// CORRECT: Use Playwright's auto-waiting
await page.getByText('Expected text').waitFor();

// WRONG: Arbitrary timeouts like page.waitForTimeout(1000)
// WRONG: Not waiting for operations to complete
```

#### Section 4: What to Test vs. What Not to Test

**DO Test:**

1. **Public API contracts** - Test methods exposed through the API module
2. **User-facing behavior** - What users can see and interact with
3. **Event emissions** - Verify correct events are dispatched with proper data
4. **Data transformations** - Input/output data format and structure
5. **Error conditions** - How the system handles invalid input or error states
6. **Integration between modules** - Module communication through events and APIs

**DO NOT Test:**

1. **Implementation details** - Private methods, internal state variables
2. **Third-party libraries** - Don't test that nanoid generates IDs or that Tailwind works
3. **TypeScript types** - Type checking is done by `tsc`, not tests
4. **Obvious framework behavior** - Don't test that DOM methods work
5. **Cosmetic styling** - Don't test CSS classes unless they affect behavior

**Examples:**

```typescript
// CORRECT: Testing behavior through public API
it('removes block and updates collection', async () => {
  const block = createBlockStub();
  await blockManager.removeBlock(block);
  expect(blockManager.blocks).not.toContain(block);
});

// WRONG: Testing implementation details
it('calls private _updateInternalState method', () => {
  const spy = vi.spyOn(blockManager, '_updateInternalState' as any);
  blockManager.removeBlock(block);
  expect(spy).toHaveBeenCalled();
});

// CORRECT: Testing event emission
it('emits BlockRemoved event when block is deleted', () => {
  const eventSpy = vi.fn();
  eventsDispatcher.on(BlockChanged, eventSpy);
  blockManager.removeBlock(block);
  expect(eventSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: BlockRemovedMutationType })
  );
});

// WRONG: Testing internal event dispatcher implementation
it('adds listener to internal callbacks array', () => {
  eventsDispatcher.on('event', vi.fn());
  expect(eventsDispatcher._callbacks['event']).toHaveLength(1);
});
```

**Coverage Guidelines:**

- **Focus on critical paths first** - Core functionality before edge cases
- **One test per behavior** - Not one test per method
- **Test edge cases that matter** - Empty arrays, null values, boundary conditions
- **Skip impossible scenarios** - Don't test for conditions that can't happen due to TypeScript types

#### Section 5: Common Pitfalls and Solutions

**Pitfall: Flaky E2E Tests**

```typescript
// WRONG: Race conditions and arbitrary waits
await page.click('[data-blok-testid="add-block"]');
await page.waitForTimeout(500); // Arbitrary wait
const blocks = await page.locator('.block').count();

// CORRECT: Use Playwright's auto-waiting
await page.getByTestId('add-block').click();
await expect(page.locator('[data-blok-element]')).toHaveCount(2);
```

**Pitfall: Mock Pollution Between Tests**

```typescript
// WRONG: Mocks carry over between tests
it('test 1', () => {
  vi.spyOn(blockManager, 'insert').mockReturnValue(block);
  // ... test code
});

it('test 2', () => {
  // insert is still mocked from test 1!
  blockManager.insert(); // Returns the mocked block
});

// CORRECT: Clean up in beforeEach and afterEach
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

**Pitfall: Not Handling DOM Cleanup**

```typescript
// WRONG: DOM elements leak between tests
it('creates toolbar', () => {
  const toolbar = new Toolbar();
  document.body.appendChild(toolbar.element);
  // Element stays in DOM
});

// CORRECT: Clean up DOM in afterEach or use proper teardown
afterEach(() => {
  document.body.innerHTML = '';
});

// OR use module's destroy method
it('creates toolbar', () => {
  const toolbar = new Toolbar();
  document.body.appendChild(toolbar.element);
  // ... test code
  toolbar.destroy?.();
});
```

**Pitfall: Testing Stale Bundle in E2E**

```typescript
// WRONG: Modify core code, then immediately run E2E
// 1. Edit src/components/block/index.ts
// 2. yarn e2e  ❌ Tests run against old bundle!

// CORRECT: Always rebuild after core changes
// 1. Edit src/components/block/index.ts
// 2. yarn build:test  ✅ Build fresh bundle
// 3. yarn e2e         ✅ Tests run against new code
```

**Pitfall: Over-Mocking in Unit Tests**

```typescript
// WRONG: Mocking everything makes tests meaningless
const blockManager = {
  insert: vi.fn(),
  remove: vi.fn(),
  blocks: [],
};
blockManager.insert.mockReturnValue(mockBlock);
expect(blockManager.insert()).toBe(mockBlock); // Testing the mock!

// CORRECT: Mock dependencies, test real behavior
const blockManager = new BlockManager({ config, eventsDispatcher });
const blocksStub = createBlocksStub([existingBlock]);
(blockManager as any)._blocks = blocksStub.proxy;

const result = blockManager.insert();
expect(blocksStub.insert).toHaveBeenCalled(); // Real logic ran
```

**Pitfall: Forgetting to Assert**

```typescript
// WRONG: Test passes but doesn't verify anything
it('updates block data', async () => {
  await blockManager.update(block, { text: 'New' });
  // No assertion! Test always passes
});

// CORRECT: Always verify the expected outcome
it('updates block data', async () => {
  const result = await blockManager.update(block, { text: 'New' });
  expect(result.data).resolves.toEqual({ text: 'New' });
  expect(blocksStub.replace).toHaveBeenCalledWith(0, result);
});
```

**Pitfall: Not Testing Error Cases**

```typescript
// INCOMPLETE: Only testing happy path
it('converts block to header', async () => {
  const result = await blockManager.convert(block, 'header');
  expect(result.name).toBe('header');
});

// COMPLETE: Test error conditions too
it('throws when target tool lacks conversion config', async () => {
  await expect(
    blockManager.convert(block, 'incompatibleTool')
  ).rejects.toThrow('Conversion from "paragraph" to "incompatibleTool" is not possible');
});
```

### Accessibility

- Use semantic HTML (`<button>` for actions, `<a>` for navigation)
- All interactive elements must be keyboard-accessible
- Use `aria-*` attributes for dynamic content
- Tests include accessibility checks via `@axe-core/playwright`

## Important Patterns

1. **Event-Driven Architecture**: Custom EventsDispatcher for typed events (`src/components/events/`)
2. **JSON Data Format**: Clean structured output, not HTML. Each block: `{ id, type, data, tunes }`
3. **Hierarchical Model**: Blocks can have `parentId` and `contentIds` (flat structure with references)
4. **Progressive Enhancement**: Uses `requestIdleCallback` for non-critical setup
5. **Sanitization**: HTML Janitor for cleaning pasted content, per-tool configs

## Configuration Rules

**DO NOT modify configuration files** unless explicitly instructed. This includes:
- `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`
- `tsconfig.json`, `eslint.config.mjs`
- `package.json`, `.env`

If a configuration change seems necessary, ask for confirmation first. This is enforced by `.cursor/rules/do-not-modify-configs.mdc`.

## Type Definitions

- **Public types**: `types/` directory - exported to consumers
- **Internal types**: `src/types-internal/` - used within the codebase
- Key internal type: `BlokModules` interface listing all module types

## File Naming

- Module files: camelCase (`blockManager.ts`, `blockEvents.ts`)
- Test files: `.test.ts` for unit tests, `.spec.ts` for E2E tests
- Type definitions: `.d.ts` in `types/` directory
