# Simplified Tools Config Design

## Problem

The current tools configuration is verbose and confusing:

```typescript
// Current - verbose and requires type casting
header: {
  class: Header as unknown as ToolConstructable,
  inlineToolbar: true,
  config: {
    shortcut: 'CMD+SHIFT+H',
    levels: [2, 3, 4],
    defaultLevel: 3,
    placeholder: 'Heading',
  },
  toolbox: [
    { icon: h1Icon, title: 'H1', data: { level: 2 } },
    { icon: h2Icon, title: 'H2', data: { level: 3 } },
    { icon: h3Icon, title: 'H3', data: { level: 4 } },
  ],
}
```

Pain points:
1. **Type casting** - `as unknown as ToolConstructable` required due to strict types
2. **Config nesting confusion** - unclear what goes in `config:` vs top-level
3. **Wrong defaults** - `inlineToolbar: true` must be set on every tool

## Solution

### 1. Flat Config Structure

Merge `config` into top-level. Blok recognizes known keys and passes the rest to the tool:

```typescript
// After - flat and clean
header: {
  class: Header,
  inlineToolbar: true,
  shortcut: 'CMD+SHIFT+H',
  levels: [2, 3, 4],
  defaultLevel: 3,
  placeholder: 'Heading',
  toolbox: [
    { icon: h1Icon, title: 'H1', data: { level: 2 } },
    { icon: h2Icon, title: 'H2', data: { level: 3 } },
    { icon: h3Icon, title: 'H3', data: { level: 4 } },
  ],
}
```

**Known keys** (Blok-level settings):
- `class` - tool constructor
- `inlineToolbar` - inline tools config
- `tunes` - block tunes config
- `shortcut` - keyboard shortcut
- `toolbox` - toolbox entries config

Everything else becomes `config` passed to the tool constructor.

### 2. Relaxed Types

Accept any constructor for `class`, validate at runtime:

```typescript
// New permissive type
type ToolClass = new (...args: any[]) => any;

// User-facing config
interface ToolSettings {
  class?: ToolClass;
  inlineToolbar?: boolean | string[];
  tunes?: boolean | string[];
  shortcut?: string;
  toolbox?: ToolboxConfig | false;
  [key: string]: unknown; // Tool-specific options
}
```

This eliminates the need for `as unknown as ToolConstructable` casting.

### 3. Default `inlineToolbar` to `true`

Most block tools want inline formatting. Flip the default:

```typescript
// Before - explicit everywhere
header: { class: Header, inlineToolbar: true },
paragraph: { class: Paragraph, inlineToolbar: true },
list: { class: List, inlineToolbar: true },

// After - implied
header: Header,
paragraph: Paragraph,
list: List,
```

Users who don't want inline tools set `inlineToolbar: false`.

## Backwards Compatibility

- Nested `config: {}` form still works - Blok merges it with top-level options
- Existing configs continue to function (except `inlineToolbar` default change)

**Breaking change:** Tools without explicit `inlineToolbar` will now show inline tools. Users who wanted no inline toolbar must add `inlineToolbar: false`.

## Files to Change

### Types
- `types/tools/tool-settings.d.ts` - new flat `ToolSettings` type with relaxed `class`
- `types/configs/blok-config.d.ts` - update `tools` type to use new settings

### Implementation
- `src/components/tools/base.ts` - extract tool config from flat structure
- `src/components/tools/block.ts` - default `inlineToolbar` to `true`
- `src/components/modules/tools.ts` - normalize config shape (support both flat and nested)

### Tests
- Update existing tests that rely on `inlineToolbar: false` default
- Add tests for flat config normalization
- Add tests for backwards compatibility with nested `config`

## Examples

### Minimal config
```typescript
tools: {
  header: Header,
  paragraph: Paragraph,
  list: List,
  bold: Bold,
  italic: Italic,
}
```

### With options
```typescript
tools: {
  header: {
    class: Header,
    levels: [1, 2, 3],
    defaultLevel: 2,
    placeholder: 'Heading',
  },
  paragraph: {
    class: Paragraph,
    preserveBlank: true,
  },
}
```

### Disabling inline toolbar
```typescript
tools: {
  code: {
    class: CodeBlock,
    inlineToolbar: false, // No formatting in code blocks
  },
}
```

### Mixed (backwards compatible)
```typescript
tools: {
  // New flat style
  header: {
    class: Header,
    levels: [1, 2, 3],
  },
  // Old nested style still works
  paragraph: {
    class: Paragraph,
    config: {
      preserveBlank: true,
    },
  },
}
```
