# CLAUDE.md

Project guidance for Claude Code (claude.ai/code) working with this repository.

---

## IMMEDIATE COMPLETION CHECKLIST

**STOP! Before saying "done" or "complete", verify ALL of the following:**

### For ANY Code Change (No Exceptions)

```
[ ] 1. Did I write tests FIRST, watch them FAIL, THEN write code? (IRON RULE)
[ ] 2. Did I run `/refactor` after code changes? (MANDATORY)
[ ] 3. Did I run final verification against master? (MANDATORY after refactor)
[ ] 4. Did I `git push` successfully? (Work NOT complete until push succeeds)
```

**If ANY box is unchecked:** Work is NOT complete. Do it NOW.

**No rationalizations:**
- "Chat is too long, instructions are far down" → INVALID. You're reading them right now.
- "User is in a hurry" → INVALID. Half-done work wastes MORE time later.
- "It's just a small change" → INVALID. Small changes break things too.
- "I'll do it in next session" → INVALID. That leaves work stranded.
- "Tests already cover it" → INVALID. Write test FIRST, watch it FAIL.

### For Session End

```
[ ] 1. All code tested (test first → fail → code → pass)
[ ] 2. `/refactor` run
[ ] 3. Final verification against master completed
[ ] 4. `git push` succeeded
[ ] 5. `git status` shows "up to date with origin"
```

**Work is DEFINITELY NOT complete if:**
- Changes exist only locally (not pushed)
- `/refactor` was never run
- Final verification was skipped
- No test was written before code

### Bug Fix IRON RULE

```
[ ] 1. Write regression test FIRST
[ ] 2. Run test → watch it FAIL (proves bug exists)
[ ] 3. Fix bug
[ ] 4. Run test → watch it PASS
[ ] 5. Re-run final verification
```

**Write code before test?** Delete it. Start over.

### Session End Commands

Run `/final-verification` for verification commands. Then:

```bash
git pull --rebase
git push
git status  # MUST show "up to date with origin"
```

**This checklist is ALWAYS executed. NO MATTER how long the chat is.**

### Red Flags - You're About to Violate The Rules

If you catch yourself thinking ANY of these, STOP and DO THE CHECKLIST:

- "Chat is too long, I can't find the instructions"
- "User is in a hurry, I'll skip verification this time"
- "It's just a small change, doesn't need full process"
- "I'll do the refactor in the next session"
- "Tests already exist, I don't need to write one first"
- "I already manually verified it works"
- "The push can wait, user can do it"
- "Final verification takes too long"

**ALL of these mean: You're rationalizing. Run the checklist NOW.**

---

## Landing the Plane (Session Completion)

**⚠️ CRITICAL: The completion checklist at the TOP of this file MUST be followed.**

Scroll up to "IMMEDIATE COMPLETION CHECKLIST" and verify ALL items before declaring work done.

**If you're reading this section instead of the checklist:** Go to the TOP of the file.

**Summary (detail is at top):**
1. Run quality gates (tests, lint, build)
2. Final verification against master - run `/final-verification`
3. **PUSH TO REMOTE** (MANDATORY)
4. Clean up
5. Verify `git status` shows "up to date with origin"
6. Hand off context

**Remember:** Every code change needs `/refactor` → `/final-verification` → push. No exceptions.

## Project Overview

Blok is a headless, block-based rich text editor (similar to Notion). Content is JSON blocks, not HTML.

## Commands

```bash
yarn serve          # Dev server
yarn build          # Production build
yarn build:test     # Test build for E2E
yarn lint           # ESLint + TypeScript
yarn test           # Unit tests (Vitest)
yarn e2e            # E2E tests (Playwright)
yarn storybook      # Storybook
```

Single test: `yarn test [file]` or `yarn e2e [file] -g "pattern"`

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

### TypeScript

**NEVER use `@ts-ignore`, `any`, or `!` assertions.** These bypass TypeScript's safety and cause crashes.

```typescript
// ❌ WRONG - Bypasses safety, crashes at runtime
const value = potentiallyNull!.toString();

// ✅ CORRECT - Proper handling
const value = potentiallyNull?.toString() ?? defaultValue;
```

If you feel the urge to use `!`, `any`, or `@ts-ignore`, you're missing a type guard. Fix the type, don't suppress the error.

Import types with `type` keyword: `import type { BlokConfig } from '../../types'`

### DOM & Styling
- Use `$` from `src/components/utils/dom` for DOM operations
- Use `data-blok-*` attributes for behavior (not CSS classes)
- **Tailwind CSS only** - use `twMerge`/`twJoin` for combining classes

### File Naming
- Modules: camelCase (`blockManager.ts`)
- Tests: `.test.ts` (unit), `.spec.ts` (E2E)
- Types: `.d.ts` in `types/`

## Testing

### IRON RULE: No Code Without Tests

**⚠️ This is also in the completion checklist at the TOP of this file.**

**ALL code changes require behavior tests.**

**Bug fixes MUST follow this exact order:**
1. Write regression test
2. Run it → watch it FAIL (proves bug exists)
3. Fix the bug
4. Run it → watch it PASS
5. Only THEN is the fix complete

**No exceptions. No "I'll test later". No "it's obvious".**

Write test first. If you write code before test, delete it and start over.

**See "IMMEDIATE COMPLETION CHECKLIST" at TOP of file for the full workflow.**

### Commands
```bash
yarn test [file]              # Single unit test
yarn test -t "pattern"        # By name
yarn e2e [file] -g "pattern"  # Single E2E test
```

**NOTE**: E2E tests automatically build before running (`yarn build:test`). No manual build needed.

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
| Testing stale bundle | Build runs automatically - just run `yarn e2e` |
| Over-mocking | Mock dependencies, test real behavior |
| Forgetting assertions | Always verify expected outcome |
| Not testing errors | Test both happy path and error cases |

### Red Flags - You're About to Violate The Rules

**⚠️ More red flags are in the completion checklist at the TOP of this file.**

If you catch yourself thinking ANY of these, STOP:
- "This is too simple to test"
- "I'll test it after"
- "Tests would just duplicate the code"
- "It's about the spirit, not the letter"
- "This case is different"
- "I already verified it manually"

**These thoughts mean you're rationalizing. Write the test first.**

## Accessibility

- Semantic HTML (`<button>` for actions, `<a>` for navigation)
- Keyboard-accessible interactive elements
- `aria-*` attributes for dynamic content
- Accessibility checks via `@axe-core/playwright`

## Configuration

**DO NOT modify** without explicit request: `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json`, `.env`

## Types

- **Public**: `types/` directory - exported to consumers
- **Internal**: `src/types-internal/` - used within codebase
- Key internal type: `BlokModules` interface

## Important Patterns

1. **Event-Driven**: Custom EventsDispatcher for typed events (`src/components/events/`)
2. **JSON Format**: Clean structured output, each block: `{ id, type, data, tunes }`
3. **Hierarchical Model**: Blocks can have `parentId` and `contentIds` (flat structure with references)
4. **Progressive Enhancement**: Uses `requestIdleCallback` for non-critical setup
5. **Sanitization**: HTML Janitor for cleaning pasted content
