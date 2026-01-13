# TunesManager Extraction Design

**Date:** 2026-01-13  
**Goal:** Extract tune-related logic from Block class into a dedicated TunesManager class for improved maintainability.

## Context

The Block class (`src/components/block/index.ts`) is ~850 lines with multiple responsibilities. Two helper classes have already been extracted (`InputManager`, `MutationHandler`). This design continues that pattern by extracting tune management.

## TunesManager Responsibilities

1. **Instantiation** - Creating tune instances from tune adapters and initial data
2. **Storage** - Holding both user tunes and default (internal) tunes
3. **Unavailable data preservation** - Keeping tune data for tunes that aren't currently loaded
4. **Menu config generation** - Building popover params for the Block Tunes menu
5. **Tune wrapping** - Applying tune wrappers to content nodes during render
6. **Save extraction** - Getting current tune data for persistence

**Not in scope** (stays in Block):
- Tune lifecycle tied to block destruction (Block calls manager methods)
- Block-level `tunes` property (delegates to manager)

## Interface

```typescript
class TunesManager {
  constructor(
    tunes: ToolsCollection<BlockTuneAdapter>,
    tunesData: { [name: string]: BlockTuneData },
    blockAPI: BlockAPIInterface
  )

  // Get menu items for Block Tunes popover
  getMenuConfig(toolRenderSettings?: MenuConfigItem | MenuConfigItem[] | HTMLElement): {
    toolTunes: PopoverItemParams[];
    commonTunes: PopoverItemParams[];
  }

  // Apply tune wrappers to content node (used during compose)
  wrapContent(contentNode: HTMLElement): HTMLElement

  // Extract current tune data for save()
  extractTunesData(): { [name: string]: BlockTuneData }

  // Access to tune instances (for Block.tunes property compatibility)
  get userTunes(): Map<string, IBlockTune>
  get defaultTunes(): Map<string, IBlockTune>
}
```

## Changes to Block Class

### Constructor
```typescript
// Before
this.composeTunes(tunesData);

// After
this.tunesManager = new TunesManager(tool.tunes, tunesData, this.blockAPI);
```

### compose()
```typescript
// Before: inline reduce over tune instances
const wrappedContentNode = [...this.tunesInstances.values(), ...]
  .reduce((acc, tune) => { ... }, contentNode);

// After
const wrappedContentNode = this.tunesManager.wrapContent(contentNode);
```

### getTunes()
```typescript
// Before: 40+ lines of logic
// After
const toolSettings = typeof this.toolInstance.renderSettings === 'function' 
  ? this.toolInstance.renderSettings() : [];
return this.tunesManager.getMenuConfig(toolSettings);
```

### save()
```typescript
// Before: inline tune data extraction
// After
const tunesData = this.tunesManager.extractTunesData();
```

## Removed from Block

- `tunesInstances` map
- `defaultTunesInstances` map
- `unavailableTunesData` object
- `composeTunes()` method
- Tune-related logic in `getTunes()` and `save()`

## File Structure

```
src/components/block/
├── index.ts           # Block class (reduced by ~100 lines)
├── api.ts             # BlockAPI (existing)
├── input-manager.ts   # InputManager (existing)
├── mutation-handler.ts # MutationHandler (existing)
└── tunes-manager.ts   # TunesManager (new)
```

## Estimated Impact

- ~100 lines removed from Block class
- ~120 lines in new TunesManager class
- Net complexity reduction through single-responsibility modules
