# Header Shortcut Design

## Overview

Allow users to type `#`, `##`, `###`, etc. followed by a space to create headers of different levels, similar to how list shortcuts work (e.g., `- ` for bullet lists).

## User Experience

**Trigger:** User types `#`, `##`, `###`, `####`, `#####`, or `######` followed by a space at the start of a paragraph.

**Behavior:**
- The paragraph converts to a Header block of the corresponding level (1-6)
- Any text after the space becomes the header content
- The caret is positioned correctly after conversion (accounting for removed `# ` characters)
- If the paragraph is nested (has depth), the header preserves that nesting level

**Edge cases:**
- If the Header tool isn't available → shortcut does nothing
- If the specific level isn't enabled in config → shortcut does nothing
- Typing `#` mid-paragraph → no conversion (must be at start)
- Seven or more `#` characters → no conversion (not a valid header level)

## Implementation Approach

**Where the code lives:** All changes go in `src/components/modules/blockEvents.ts`, following the exact pattern used for list shortcuts.

**Changes needed:**

1. **Add a new regex pattern** (alongside the existing list patterns):
   ```typescript
   private static readonly HEADER_PATTERN = /^(#{1,6})\s([\s\S]*)$/;
   ```
   This captures the `#` characters (1-6) and any content after the space.

2. **Add a new handler method** `handleHeaderShortcut()`:
   - Get current block (must be paragraph/default tool)
   - Check if Header tool is available
   - Get the text content and test against the pattern
   - Extract header level from the number of `#` characters
   - Verify that level is enabled in the Header tool's config
   - Use `BlockManager.replace()` to convert to Header with `{ level, text }`
   - Restore caret position

3. **Call the handler from `input()` method:**
   - Add `this.handleHeaderShortcut()` call alongside `this.handleListShortcut()`
   - Both return early if they successfully convert, so order doesn't matter

**No changes needed to:** Header tool, BlockManager, or any other modules.

## Level Validation

**The challenge:** We need to check if a header level is enabled in the Header tool's config before converting.

**How to access the config:**
- The `Tools` module provides access to available tools via `this.Blok.Tools`
- We can get the Header tool's settings to check which levels are enabled
- The Header tool accepts a `levels` config (e.g., `levels: [1, 2, 3]`) - if not specified, all 1-6 are available

**Validation flow:**
1. Match the pattern and extract level (count of `#` characters)
2. Get the Header tool from `Tools` module
3. Check the tool's config for `levels` array
4. If `levels` is defined and doesn't include our level → abort (no conversion)
5. If `levels` is undefined → all levels allowed, proceed

**Example scenarios:**
- Config: `levels: [1, 2, 3]` → typing `####` does nothing, typing `##` converts to H2
- Config: not specified → all `#` through `######` work
- Config: `levels: [2]` → only `##` triggers conversion

## Testing Strategy

**E2E tests** (in `test/playwright/tests/`):

1. **Basic conversions** - `# `, `## `, `### ` each create correct header level
2. **Content preservation** - `## Hello world` becomes H2 with "Hello world" text
3. **Caret positioning** - cursor is at correct position after conversion
4. **Level limits** - `#######` (7 hashes) does nothing
5. **Mid-paragraph** - typing `# ` in the middle of text does nothing
6. **Config respect** - when `levels: [1, 2]` is configured, `### ` does nothing
7. **Tool unavailable** - if Header tool isn't registered, shortcuts do nothing
