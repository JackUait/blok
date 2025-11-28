# Blok - AI Coding Instructions

## Project Overview

Blok is a headless, block-based rich text editor. Content is structured as JSON blocks, not raw HTML.

## Architecture

### Core Components (`src/components/`)
- **`core.ts`**: Bootstrap orchestrator - initializes all modules, manages editor lifecycle
- **`__module.ts`**: Base class all modules inherit from - provides `listeners`, `config`, `Blok` references
- **`block/index.ts`**: Block class representing individual content blocks with lifecycle hooks (`rendered`, `updated`, `removed`, `moved`)
- **`blocks.ts`**: Array-like collection manager for Block instances

### Module System (`src/components/modules/`)
Modules are singletons instantiated by Core. Key modules:
- **`blockManager.ts`**: Creates/deletes/reorders blocks
- **`ui.ts`**: DOM structure and event delegation
- **`tools.ts`**: Tool registry and instantiation
- **`caret.ts`**: Cursor position management
- **`api/`**: Public API exposed to tools (blocks, caret, events, saver, etc.)

### Type Definitions
- **`types/`**: Public API types exported to consumers
- **`src/types-internal/`**: Internal types (e.g., `BlokModules` interface listing all module types)

## Development Commands

```bash
yarn serve          # Dev server with hot reload (opens browser)
yarn build          # Production build to dist/
yarn lint           # ESLint + TypeScript type checking (both must pass)
yarn lint:fix       # Auto-fix ESLint issues
yarn test           # Vitest unit tests
yarn test:watch     # Vitest watch mode
yarn e2e            # Playwright tests (all browsers)
yarn e2e:ui         # Playwright UI mode for debugging
yarn e2e:chrome     # Playwright Chromium only
yarn e2e:firefox    # Playwright Firefox only
yarn e2e:safari     # Playwright Safari only
```

## Testing Patterns

### Unit Tests (`test/unit/`)
- Use Vitest with `vi.mock()` for module mocking
- Mock Core and modules to test in isolation (see `blok.test.ts` for pattern)

### E2E Tests (`test/playwright/tests/`)
- Use resilient locators: `page.getByRole()`, `page.getByText()` over CSS selectors
- Test attribute: `data-blok-testid` (configured in `playwright.config.ts`)
- E2E tests load actual editor bundle - run `yarn build:test` if bundle is stale
- See `test/testcases.md` for comprehensive test scenarios

## Code Conventions

### TypeScript
- **Never use `@ts-ignore`, `any`, or `!` assertions** - fix type errors properly with guards/narrowing
- Import types with `type` keyword: `import type { BlokConfig } from '../../types'`
- Module classes extend `Module<T>` base class for consistent lifecycle

### DOM Utilities
- Use `$` from `./dom` for DOM creation/manipulation (jQuery-like API)
- Use `*` from `./utils` for general utilities
- CSS selectors use constants from `constants.ts` (e.g., `BLOK_INTERFACE_SELECTOR`)

### Linting
- Run `yarn lint:fix` first, manual fixes only if autofix fails
- ESLint config at `eslint.config.mjs` is source of truth

### Accessibility
- Semantic HTML elements required (`button` for actions, `a` for navigation)
- All interactive elements must be keyboard-accessible
- Use `aria-*` attributes appropriately for dynamic content

## Key Integration Points

### Creating Custom Tools
Tools implement `BlockTool` interface (`types/tools/block-tool.d.ts`):
- `render()`: Returns HTMLElement for the block
- `save(block)`: Extracts data from DOM
- `validate?(data)`: Optional data validation
- Lifecycle: `rendered()`, `updated()`, `removed()`, `moved()`

### Blok Configuration
Entry point: `src/blok.ts` exports `Blok` class
Key config options: `holder`, `tools`, `data`, `autofocus`, `defaultBlock`, `readOnly`

## File Naming
- Module files: lowercase with hyphens (`blockManager.ts`, `blockEvents.ts`)
- Test files: `.test.ts` for unit, `.spec.ts` for E2E
- Type definition files: `.d.ts` in `types/` directory
