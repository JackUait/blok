# Remove Tool-Specific Tunes from Block Settings

## Problem

When a user opens block settings (the gear menu) on any block, tool-specific tunes appear at the top level of the menu. For example, opening settings on an H1 block shows H1-H6 level selectors and a "Toggle heading" option directly in the menu, above the Convert To submenu. These same variants already appear inside Convert To, creating redundancy. The "Toggle heading" entry also appears as a separate tool in the toolbox (slash menu), which is unwanted.

## Changes

### 1. Remove tool tunes from block settings menu

**File:** `src/components/modules/toolbar/blockSettings.ts`

Remove the code in `getTunesItems()` that injects `toolTunes` at the top level of the menu (lines 309-314). Also remove the now-unused `toolTunes` parameter from the `getTunesItems()` method signature and its caller. After this change, the block settings menu structure becomes:

1. Convert To submenu (all convertible tool variants)
2. Separator
3. Common tunes (delete, move, etc.)

This is a universal change affecting all block tools. All tools that return items from `renderSettings()` (Header with level selectors, List with style selectors) will have those items accessible only via Convert To going forward.

Note: `block.getTunes()` still calls `renderSettings()` internally, and `toolTunes` is still used by the toolbar (to determine gear icon visibility). Only the display in the block settings popover is removed.

### 2. Remove toggle heading entries from the toolbox

**File:** `src/tools/header/index.ts`

In `static get toolbox()`, remove the `toggleHeadingEntries` array (lines 1217-1233) and the spread into the return. The toolbox returns only H1-H6 entries.

This removes toggle headings from:
- The slash menu (/ command) and plus button toolbox
- The Convert To submenu (which reads from toolbox entries)

### 3. Remove toggle heading tune from renderSettings

**File:** `src/tools/header/index.ts`

In `renderSettings()`, remove the toggle heading comment, variable, and push (lines 397-408). Although Change 1 already prevents `renderSettings()` output from appearing in the menu, this ensures the toggle heading option is completely removed from the tool's settings.

### 4. Remove toggle heading markdown shortcuts

**File:** `src/components/modules/blockEvents/composers/markdownShortcuts.ts`

Remove `handleToggleHeaderShortcut()` (lines 216-279), `setCaretAfterToggleArrow()` (lines 379-398), their invocations, and the `TOGGLE_HEADER_PATTERN` import.

**File:** `src/components/modules/blockEvents/constants.ts`

Remove the `TOGGLE_HEADER_PATTERN` constant (line 77).

This eliminates the last user-facing creation path for toggle headings.

### 5. Clean up dead code

**File:** `src/components/tools/block.ts`

Remove the `_toolboxEntries` injection in `BlockToolAdapter.create()` (lines 55-72) — this was used solely to let `renderSettings()` build settings matching the toolbox config, which is no longer displayed.

**File:** `src/tools/header/index.ts`

- Remove `buildSettingsFromToolboxEntries()` and the `_toolboxEntries` references in `renderSettings()`. The `renderSettings()` method can return the default level items directly.
- Remove `_toolboxEntries` property from the `HeaderConfig` interface.
- Remove `toggleIsToggleable()` — no longer reachable from any UI path.
- Remove unused `IconToggleH1`, `IconToggleH2`, `IconToggleH3` imports.

Toggle heading rendering and expand/collapse infrastructure (constructor logic, `toggleOpen()`, `expand()`, `collapse()`, `buildWrapper()`, keyboard handlers, etc.) remains intact so existing toggle heading blocks continue to function.

**i18n keys:** The following translation keys become dead across all locale files: `tools.header.toggleHeading`, `tools.header.toggleHeading1`, `tools.header.toggleHeading2`, `tools.header.toggleHeading3`. Leave them in place for backward compatibility with user-provided translations.

## Existing toggle heading blocks

After these changes, there is no UI path to create new toggle headings or to toggle `isToggleable` on/off. Existing toggle heading blocks continue to function (render, expand/collapse). To convert a toggle heading back to a regular heading, users use Convert To (e.g., Toggle H2 -> H2). The existing child-warning dialog in `blockSettings.ts` handles the case where a toggle heading has nested children.

## What stays unchanged

- `renderSettings()` methods on all tools remain (part of the `BlockTool` public interface) — they are still called by `block.getTunes()`, just not displayed in the block settings popover
- Toggle heading rendering and interaction remains intact for existing blocks
- Convert To continues to work for all non-toggle heading variants
- The toolbox (slash menu / plus button) continues to show H1-H6 and all other block tools

## Menu structure after changes

**Before (H1 block):**
```
H1 (active)        <-- tool tune
H2                  <-- tool tune
H3                  <-- tool tune
...
Toggle heading      <-- tool tune
---
Convert To >        <-- submenu with H2-H6, Toggle H1-H3, paragraph, list, etc.
---
Delete
```

**After (H1 block):**
```
Convert To >        <-- submenu with H2-H6, paragraph, list, etc. (no toggle headings)
---
Delete
```

## Testing

Existing tests that will need updating:
- `test/unit/components/modules/toolbar/blockSettings.test.ts` — references to `toolTunes` display
- `test/unit/tools/header.test.ts` — references to `_toolboxEntries`, toggle heading in settings and toolbox
- `test/unit/tools/block.test.ts` — asserts `_toolboxEntries` injection in BlockToolAdapter
- `test/playwright/tests/tools/block-tool.spec.ts` — E2E test for `_toolboxEntries` injection
- `test/playwright/tests/tools/toggle-headings.spec.ts` and `toggle-heading.spec.ts` — E2E tests for toggle heading creation/conversion
- `test/unit/components/modules/blockEvents/composers/markdownShortcuts.test.ts` — toggle header shortcut tests
- `test/playwright/tests/tools/header-shortcut.spec.ts` — E2E tests for toggle header shortcuts (`>#`, `>##`, `>###`)
- `test/playwright/tests/ui/plus-button-slash.spec.ts` — count assertions include toggle heading entries
- `test/playwright/tests/ui/multilingual-search.spec.ts` — search expects toggle heading results

Verification:
- Block settings menu shows only Convert To + common tunes (no top-level tool tunes) for all block types (header, list, etc.)
- Toggle heading does not appear in toolbox, Convert To, block settings, or via markdown shortcuts
- Heading level switching works via Convert To (H1 to H2, etc.)
- List style switching works via Convert To (bulleted to numbered, etc.)
- Existing toggle heading blocks still render and function correctly
- Converting a toggle heading via Convert To correctly removes `isToggleable` and handles children
