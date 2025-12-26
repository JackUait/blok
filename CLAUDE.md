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
yarn e2e              # Run all E2E tests (all browsers)
yarn e2e:smoke        # Smoke tests (Chromium, @smoke tagged)
yarn e2e:chrome       # Chromium only
yarn e2e:firefox      # Firefox only
yarn e2e:safari       # WebKit/Safari only
yarn e2e:ui           # Playwright UI mode for debugging tests
yarn e2e:ui:chrome    # UI mode with Chromium only
yarn e2e:ui:firefox   # UI mode with Firefox only
yarn e2e:ui:safari    # UI mode with Safari only
```

**Important**: E2E tests load the actual editor bundle from `dist/`. If you modify core code, run `yarn build:test` before running E2E tests to avoid testing stale code.

### Running a Single Test
```bash
# Single unit test file
yarn test src/components/utils/dom.test.ts

# Single unit test by name pattern
yarn test -t "should sanitize HTML"

# Single E2E test file
yarn e2e test/playwright/tests/modules/blockManager.spec.ts

# Single E2E test by name pattern
yarn e2e -g "deletes the last block"

# E2E test file
yarn e2e test/playwright/tests/modules/blockManager.spec.ts

# E2E test file + specific test name
yarn e2e test/playwright/tests/modules/blockManager.spec.ts -g "deletes the last block"
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

### Avoid Over-Engineering

Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused:

- Don't add features or make "improvements" beyond what was asked
- A simple feature doesn't need extra configurability
- Only add comments where the logic isn't self-evident
- Use defensive programming strategy, but don't add error handling, fallbacks, or validation for scenarios that can't happen
- Don't create helpers, utilities, or abstractions for one-time operations, unless it's required to fix a linting problem
- Don't design for hypothetical future requirements
- Three similar lines of code is better than a premature abstraction

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

### Testing Patterns

**Unit Tests** (`test/unit/`):
- Use Vitest with `vi.mock()` for module mocking
- Mock Core and modules to test in isolation
- See `test/unit/blok.test.ts` for patterns

**E2E Tests** (`test/playwright/tests/`):
- Use resilient locators: `page.getByRole()`, `page.getByText()` over CSS selectors
- Test attribute: `data-blok-testid` (configured in `playwright.config.ts`)
- Remember: E2E tests use the built bundle - run `yarn build:test` after core changes

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
