# Individual Heading Levels in Popovers

## Summary

Show individual heading levels (H1, H2, H3, etc.) as separate entries in all popovers where adding or converting blocks is possible, instead of a single generic "Heading" option.

## Affected Popovers

- **Toolbox** (+ button / slash menu) - for adding new blocks
- **Convert To submenu** (in Block Settings) - for converting existing blocks

## Behavior

| Scenario | Toolbox / Convert To shows |
|----------|---------------------------|
| No config (default) | H1, H2, H3, H4, H5, H6 (6 entries) |
| `levels: [1, 2, 3]` | H1, H2, H3 (3 entries) |
| `levels: [2]` | H2 only (1 entry) |

Each entry uses its level-specific icon (IconH1, IconH2, etc.).

## Changes

### 1. Header Tool (`src/tools/header/index.ts`)

Replace the static `toolbox` getter (lines 647-653) to return an array of all 6 levels:

```typescript
public static get toolbox(): ToolboxConfig {
  return Header.DEFAULT_LEVELS.map(level => ({
    icon: level.icon,
    title: level.name,
    titleKey: level.nameKey.replace('tools.header.', ''),
    data: { level: level.number },
  }));
}
```

### 2. BlockToolAdapter (`src/components/tools/block.ts`)

Add filtering in the `toolbox` getter (after line 116) to respect `levels` config:

```typescript
// Filter entries by 'levels' config if present
const levels = this.settings.levels as number[] | undefined;

if (Array.isArray(levels) && levels.length > 0) {
  return mergedEntries.filter(entry => {
    const entryLevel = (entry.data as { level?: number })?.level;
    return entryLevel === undefined || levels.includes(entryLevel);
  });
}
```

This mirrors the existing `filterToolboxEntriesByStyles` pattern.

## What Stays the Same

- Block Settings (☰) behavior unchanged - already shows individual levels via `renderSettings()`
- User can still override via `toolbox` config in tool settings
- Shortcuts, paste handling, level switching all work as before
