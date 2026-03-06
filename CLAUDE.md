# CLAUDE.md

Project guidance for Claude Code (claude.ai/code) working with this repository.

---

## IMMEDIATE COMPLETION CHECKLIST

**STOP! Before saying "done" or "complete", verify ALL of the following:**

```
[ ] 1. Did I write tests FIRST, watch them FAIL, THEN write code? (IRON RULE)
        Bug fixes: also watch the fix PASS, then re-run the full suite.
[ ] 2. `git pull --rebase` and `git push` succeeded
[ ] 3. `git status` shows "up to date with origin"
```

**If ANY box is unchecked:** Work is NOT complete. Do it NOW.

**No rationalizations:**
- "Chat is too long" → INVALID. You're reading them right now.
- "User is in a hurry" → INVALID. Half-done work wastes MORE time later.
- "It's just a small change" → INVALID. Small changes break things too.
- "I'll do it in next session" → INVALID. That leaves work stranded.
- "Tests already cover it" → INVALID. Write test FIRST, watch it FAIL.
- "I already manually verified it works" → INVALID. Tests first.
- "The push can wait, user can do it" → INVALID. Push before declaring done.

### Failure Recovery Protocol

**When pre-commit hook, tests, lint, build, or any verification fails:**

1. **Determine session blame FIRST** — Run `git diff --name-only` to get files changed in this session. Check if the failing files overlap with your changed files.
   - **Failures in files you changed** → Your responsibility. Proceed to step 2.
   - **Failures ONLY in files you did NOT change** → Pre-existing. You MAY skip with `--no-verify` for this commit only. Log which failures were skipped and why in the commit message.

2. **Deploy parallel subagents** — For failures you own, launch one `Task` tool agent per failure category (e.g., one for lint fixes, one for test fixes). Do NOT fix failures sequentially in the main context — subagents are faster and preserve context.

3. **Re-run full verification** — After all subagents complete, re-run the failing checks. If new failures appear, repeat from step 1.

**No rationalizations:**
- "I'll fix it manually instead of using subagents" → INVALID. Subagents are faster and preserve main context.
- "All failures are pre-existing" → VERIFY with `git diff`. Don't assume.
- "Subagents are overkill for one error" → Use them anyway. Consistency matters.
- "I'll just use --no-verify" → ONLY allowed after git diff proves failures are pre-existing.

**This checklist is ALWAYS executed. NO MATTER how long the chat is.**

---

## Landing the Plane (Session Completion)

Before declaring done: run quality gates (`yarn lint`, `yarn test`), push, clean up local state, and hand off context. Run the checklist above.

## Project Overview

Blok is a headless, block-based rich text editor (similar to Notion). Content is JSON blocks, not HTML.

## Commands

```bash
# Core
yarn serve          # Dev server
yarn build          # Production build
yarn build:test     # Test build for E2E
yarn lint           # ESLint + TypeScript
yarn test           # Unit tests (Vitest)
yarn e2e            # E2E tests (Playwright)
yarn storybook      # Storybook

# Docs (React documentation site)
yarn serve:docs     # Docs dev server
yarn serve:docs:prod # Serve production docs build
```

Single test: `yarn test [file]`, `yarn test -t "pattern"`, or `yarn e2e [file] -g "pattern"`

## Releasing

```bash
yarn release 1.0.0                # stable release
yarn release 1.0.0-beta.1         # beta release (auto-detected from version)
```

See `scripts/release.mjs` for the full workflow. Publish happens **before** git push. The GitHub release is created as a **draft** — edit it to add categorized release notes before publishing.

### GitHub Release Notes

- **Never use `--generate-notes`** for GitHub releases — it dumps everything under "Other Changes"
- **Always write categorized release notes** with these sections:
  - **Features** — new functionality, with PR numbers
  - **Bug Fixes** — fixes, one line each
  - **Maintenance** — dependency upgrades, tooling, tests, chores
- Group related commits into single bullet points (e.g. multiple marker commits → one "Marker Inline Tool" feature)
- Reference PR numbers where available

## Architecture

Entry: `src/blok.ts` → `Core` (`src/components/core.ts`) → modules

**Module System**: All modules extend `Module` base class, communicate via `EventsDispatcher`. Key modules in `src/components/modules/`:

- **BlockManager**: Creates/deletes/reorders blocks
- **UI**: DOM structure, event delegation
- **Toolbar**: Plus button (+) and settings toggler (☰)
- **Toolbox**: Slash menu (/ or + button)
- **InlineToolbar**: Text formatting (bold, italic, link)
- **BlockSettings**: Block settings menu (☰)
- **DragManager**: Pointer-based drag & drop
- **Caret**: Cursor position management
- **Saver**: Extracts JSON data
- **Renderer**: Renders blocks from JSON
- **History**: Undo/redo
- **Paste**: Clipboard operations
- **API**: Public API

**Blocks** (`src/components/block/index.ts`): Fundamental unit. Wraps Tool. Has unique id, data, parentId/contentIds. Lifecycle: rendered/updated/removed/moved.

DOM: `holder` → `contentElement` → `toolRenderedElement`

## Tools

Tools implement `BlockTool` interface (`types/tools/block-tool.d.ts`):

```typescript
class MyTool {
  static get toolbox() { return { title: 'My Tool', icon: '<svg>...</svg>' }; }
  render() { return document.createElement('div'); }
  save(blockContent) { return { text: blockContent.textContent }; }
  validate(savedData) { return savedData.text.length > 0; }
  rendered() { }
  updated() { }
  removed() { }
  moved() { }
}
```

See `src/tools/` for examples: paragraph/, header/, list/

**Toolbox**: Triggered by "/" in empty paragraph or clicking + button. Uses Popover component.

**Drag & Drop**: Pointer-based (not HTML5 drag API) from ☰ icon. See `src/components/modules/dragManager.ts`.

## Code Conventions

### Avoid Over-Engineering
- Don't add features beyond what's asked
- Don't create helpers for one-time operations
- Three similar lines > premature abstraction
- Only comment where logic isn't self-evident


## Testing

### Critical Rules (Violations = Wrong Work)

**E2E:**
- Build runs automatically before tests - no manual step needed
- NEVER use CSS class selectors → use semantic locators or `data-blok-testid`
- NEVER forget async/await → Playwright is async
- NEVER assume immediate availability → use waitFor or auto-waiting

**Unit:**
- NEVER use `@ts-ignore`, `any`, or `!` → use proper type guards
- ALWAYS call `vi.clearAllMocks()` in beforeEach
- NEVER mock what you're testing → mock dependencies only
- ALWAYS restore mocks in afterEach (`vi.restoreAllMocks()`)

**Architecture:**
- Test behavior through public APIs, NOT private methods
- Test event emissions with proper data
- NEVER bypass the module system

**Bugs:**
- ALWAYS write regression test BEFORE fixing
- Test MUST fail first (otherwise it's not a regression)
- NEVER fix without test coverage

### Patterns

**Mocking modules** (see `test/unit/blok.test.ts`):
```typescript
vi.mock('../../src/components/core', () => {
  const mockModuleInstances = { API: { methods: {} }, Toolbar: {} };
  class MockCore { public moduleInstances = mockModuleInstances; public isReady = Promise.resolve(); }
  return { Core: MockCore, mockModuleInstances };
});
```

**Factory fixtures** (see `test/unit/components/modules/blockManager.test.ts`):
```typescript
const createBlockStub = (options: { id?: string } = {}): Block => ({
  id: options.id ?? `block-${Math.random()}`,
  name: 'paragraph',
  holder: document.createElement('div'),
} as unknown as Block);
```

**E2E locators** (priority order):
1. Role-based: `page.getByRole('button', { name: 'Submit' })`
2. Text-based: `page.getByText('Hello World')`
3. Test ID: `page.getByTestId('block-settings')` (uses `data-blok-testid`)
4. NEVER: CSS class selectors

**Custom tools** (inject via classCode):
```typescript
const CUSTOM_TOOL = `(() => {
  return class CustomTool {
    static get toolbox() { return { icon: '', title: 'Custom' }; }
    render() { return document.createElement('div'); }
    save(element) { return { text: element.innerHTML }; }
  };
})();
`;
```

### What to Test vs Not

**DO Test:**
- Public API contracts
- User-facing behavior
- Event emissions
- Data transformations
- Error conditions
- Module integration

**DO NOT Test:**
- Private methods
- Third-party libraries
- TypeScript types
- Obvious framework behavior
- Cosmetic styling

### Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Flaky E2E with arbitrary waits | Use Playwright's auto-waiting |
| Mock pollution between tests | `vi.clearAllMocks()` in beforeEach, `vi.restoreAllMocks()` in afterEach |
| DOM elements leak | Clean up in afterEach or use destroy() |
| Over-mocking | Mock dependencies, test real behavior |
| Forgetting assertions | Always verify expected outcome |
| Not testing errors | Test both happy path and error cases |

## Accessibility

- Semantic HTML (`<button>` for actions, `<a>` for navigation)
- Keyboard-accessible interactive elements
- `aria-*` attributes for dynamic content
- Accessibility checks via `@axe-core/playwright`

## Documentation

The documentation is a React application in the `docs/` directory with its own `package.json`.

### Docs Commands

```bash
# From project root
yarn serve:docs         # Dev server with proxy to blok demo

# From docs/ directory
yarn test
```

### Docs Testing

Uses Vitest with React Testing Library. Tests are co-located with components.

```bash
# Run all docs tests
cd docs && yarn test
```

### Plans Directory

`docs/plans/` contains design documents for refactoring work. These are architectural plans, not implementation tasks.

## Configuration

**DO NOT modify** without explicit request: `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json`, `.env`

## Types

- **Public**: `types/` directory - exported to consumers
- **Internal**: `src/types-internal/` - used within codebase
- Key internal type: `BlokModules` interface

## Important Patterns

1. **Event-Driven**: Custom EventsDispatcher for typed events (`src/components/events/`)
2. **JSON Format**: Clean structured output, each block: `{ id, type, data, tunes }`
