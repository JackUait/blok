# Plus Button Inserts "/" Paragraph

## Overview

Change the "+" button behavior to insert a paragraph with "/" pre-filled instead of directly opening the toolbox popover. This creates a more consistent experience where the slash menu always appears in context of a block.

## Behavior

When the user clicks the "+" button:

1. **If the hovered block is an empty paragraph** → Insert "/" into it and place caret after the "/"
2. **Otherwise** → Create a new paragraph below the hovered block, insert "/" into it, and place caret after the "/"

In both cases, the slash menu opens automatically.

## Implementation

### File Changed

`src/components/modules/toolbar/index.ts` - `plusButtonClicked()` method

### Current Flow

```
plusButtonClicked() → toolboxInstance.toggle()
```

### New Flow

```
plusButtonClicked() →
  1. Check if hovered block is empty paragraph
     - Yes: use it
     - No: insert new paragraph below hovered block
  2. Focus the target paragraph
  3. Insert "/" at caret position
  4. Open the toolbox
```

### Methods Used

- `BlockManager.insert()` - create new paragraph below hovered block
- `Caret.setToBlock()` - focus the target paragraph
- `Caret.insertContentAtCaretPosition('/')` - insert the slash character
- `Toolbar.moveAndOpen()` - reposition toolbar to new block
- `Toolbar.toolbox.open()` - open the slash menu

### Empty Paragraph Detection

Check both conditions:
- `hoveredBlock.isEmpty` - block has no content
- `hoveredBlock.name === 'paragraph'` - block is a paragraph type

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Hovered block is empty paragraph | Reuse it, insert "/" |
| Hovered block has content | Create new paragraph below |
| Hovered block is different type (empty header, list) | Create new paragraph below |
| No hovered block | Use current block logic as fallback |

## Testing

- Click "+" on block with content → new paragraph with "/" appears below
- Click "+" on empty paragraph → "/" inserted into existing paragraph
- Click "+" on empty header → new paragraph with "/" appears below
- Caret should be positioned after "/" in all cases
- Slash menu should open in all cases
