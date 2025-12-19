# Bundle Size Reduction Design

## Overview

Reduce Blok's bundle size from 200 KB gzipped to under 100 KB gzipped for the core bundle by:
1. Replacing heavy dependencies with native implementations
2. Making built-in tools optional (separate entry points)
3. Lazy-loading i18n only when non-English locales are used

## Current State

**Bundle size:** 836 KB raw / 200 KB gzipped

### Breakdown by category

| Category | Raw Size | Notes |
|----------|----------|-------|
| Dependencies | ~290 KB | lodash (112), tailwind-merge (95), i18next (78) |
| Built-in tools | ~170 KB | paragraph, header, list, bold, italic, link, etc. |
| Core modules | ~375 KB | block, toolbar, history, paste, drag, caret, etc. |

### Dependencies

| Dependency | Size | Usage |
|------------|------|-------|
| lodash | 112 KB | 12 utility functions in `src/components/utils.ts` |
| tailwind-merge | 95 KB | Class conflict resolution for Tailwind |
| i18next | 78 KB | Internationalization framework |
| html-janitor | 6 KB | HTML sanitization (keep) |
| nanoid | 1 KB | ID generation (keep) |

---

## Strategy 1: Replace Lodash with Native Implementations

**Savings:** ~112 KB raw / ~25 KB gzipped

### Functions to replace

| Function | Native Replacement |
|----------|-------------------|
| `isBoolean` | `typeof x === 'boolean'` |
| `isString` | `typeof x === 'string'` |
| `isNumber` | `typeof x === 'number' && !Number.isNaN(x)` |
| `isUndefined` | `x === undefined` |
| `isFunction` | `typeof x === 'function'` |
| `isEmpty` | Custom ~10 line function |
| `isPlainObject` | Custom ~5 line function |
| `isEqual` | Custom deep-equal (~30 lines) |
| `toArray` | `Array.from()` |
| `delay` | `setTimeout` wrapper |
| `throttle` | Custom ~20 lines |
| `mergeWith` | Custom deep-merge (~25 lines) |

### Implementation

Update `src/components/utils.ts`:
- Remove all lodash imports
- Implement native replacements inline
- Maintain exact same export signatures for backwards compatibility

### Risk

Low — these are well-understood utilities with clear semantics. Add unit tests for edge cases.

---

## Strategy 2: Replace tailwind-merge with Custom Minimal Merger

**Savings:** ~80 KB raw / ~20 KB gzipped

### Why tailwind-merge is heavy

It includes full Tailwind class parsing, conflict resolution for all utilities, and support for arbitrary values. Most of this isn't needed for Blok's controlled internal class usage.

### Custom implementation

Build a focused solution (~15-20 lines) that handles only the class conflicts Blok actually encounters:

```typescript
function twMerge(...classes: (string | undefined)[]): string {
  const result = new Map<string, string>();

  for (const cls of classes.flatMap(c => c?.split(/\s+/) ?? [])) {
    if (!cls) continue;
    const category = getCategory(cls);
    result.set(category, cls);
  }

  return [...result.values()].join(' ');
}
```

The `getCategory` function handles classes used in Blok:
- Padding/margin (`p-*`, `m-*`, `px-*`, etc.)
- Display (`flex`, `block`, `hidden`)
- Colors (`text-*`, `bg-*`)
- Sizing (`w-*`, `h-*`)

### Migration path

1. Audit all `twMerge` and `twJoin` call sites in Blok
2. Catalog which class conflicts actually occur
3. Build minimal merger that handles those specific cases
4. Test extensively for visual regressions

### Risk mitigation

- Keep tailwind-merge as dev dependency for comparison testing
- Add unit tests comparing custom merger output against tailwind-merge for all actual usage patterns

---

## Strategy 3: Lazy-load i18next

**Savings:** ~78 KB raw / ~18 KB gzipped (for English-only users)

### Current situation

- i18next bundled into core
- 68 locale files already code-split
- Most users likely only use English or one locale

### Implementation

Ship core with simple English strings, load i18next only when needed:

```typescript
// Core ships with English defaults
const defaultStrings = {
  'toolbox.add': 'Add',
  'toolbar.bold': 'Bold',
  // ... all English defaults
};

// When non-English locale configured:
if (locale !== 'en') {
  const { initI18n } = await import('./i18n/loader');
  await initI18n(locale);
}
```

### Steps

1. Extract all translatable strings to a key-value map for English
2. Create thin wrapper returning English strings synchronously
3. When non-English locale configured, dynamically import i18next + locale file
4. Swap the string resolver once loaded

### Edge case

Strings needed before async load completes — show English fallbacks (acceptable UX).

---

## Strategy 4: Extract Built-in Tools to Separate Entry Points

**Savings:** ~170 KB raw / ~40 KB gzipped (when not using built-in tools)

### Current built-in tools

| Tool | Size | Type |
|------|------|------|
| Bold inline tool | ~65 KB | Inline |
| List | ~57 KB | Block |
| Header | ~14 KB | Block |
| Link inline tool | ~13 KB | Inline |
| Paragraph | ~8 KB | Block |
| Convert inline tool | ~5 KB | Inline |
| Italic inline tool | ~3 KB | Inline |
| Stub | ~2 KB | Block |
| Delete tune | ~2 KB | Tune |

### New entry point structure

```
@jackuait/blok                    → Core only
@jackuait/blok/tools              → All built-in tools
@jackuait/blok/tools/paragraph    → Individual tools
@jackuait/blok/tools/header
@jackuait/blok/tools/list
@jackuait/blok/tools/bold
@jackuait/blok/tools/italic
@jackuait/blok/tools/link
@jackuait/blok/full               → Core + all tools (convenience)
@jackuait/blok/locales            → (existing) locale loader
```

### What stays in core

- Stub tool (needed for graceful handling of unknown block types)
- Delete tune (fundamental block operation)
- Inline tool infrastructure (but not bold/italic/link implementations)

### Usage after change

```typescript
// Option 1: Explicit tools (smallest bundle)
import { Blok } from '@jackuait/blok';
import { Paragraph, Header, List, Bold, Italic, Link } from '@jackuait/blok/tools';

new Blok({
  tools: { paragraph: Paragraph, header: Header, list: List },
  inlineTools: { bold: Bold, italic: Italic, link: Link }
});

// Option 2: Batteries-included (same as current behavior)
import { Blok, defaultTools } from '@jackuait/blok/full';

new Blok({ tools: defaultTools });
```

### Breaking changes

1. Tools no longer auto-included — users must import explicitly
2. `Blok.Paragraph`, `Blok.Header`, `Blok.List` static properties removed
3. Re-exports from main entry removed

---

## Strategy 5: Update Codemod

### Extend existing codemod

Update `codemod/migrate-editorjs-to-blok.js` to handle both:
1. EditorJS → Blok migration (existing)
2. Old Blok imports → modular imports (new)

### Additional transformations

**Detect Blok imports and modernize:**

```typescript
// Before
import Blok from '@jackuait/blok';
import { Header } from '@jackuait/blok';

// After
import { Blok } from '@jackuait/blok';
import { Header } from '@jackuait/blok/tools';
```

**Replace static property access:**

```typescript
// Before
tools: { paragraph: Blok.Paragraph, header: Blok.Header }

// After
tools: { paragraph: Paragraph, header: Header }
// (also adds missing imports)
```

### Behavior

- Auto-detects whether source uses EditorJS or old Blok patterns
- Applies relevant transformations
- Idempotent — safe to run multiple times

---

## Expected Impact

### Reduction breakdown

| Change | Raw Savings | Gzip Savings (est.) |
|--------|-------------|---------------------|
| Remove lodash → native | ~112 KB | ~25 KB |
| Replace tailwind-merge | ~80 KB | ~20 KB |
| Lazy-load i18next | ~78 KB | ~18 KB |
| Extract built-in tools | ~170 KB | ~40 KB |
| **Total** | **~440 KB** | **~103 KB** |

### Projected bundle sizes

| Bundle | Current | After |
|--------|---------|-------|
| Core (gzip) | 200 KB | ~97 KB |
| Core + all tools (gzip) | 200 KB | ~137 KB |
| Core + tools + i18n (gzip) | 200 KB | ~155 KB |

---

## Implementation Order

1. **Replace lodash** — lowest risk, immediate savings
2. **Replace tailwind-merge** — moderate risk, requires thorough testing
3. **Extract built-in tools** — breaking change, coordinate with major version
4. **Lazy-load i18next** — moderate complexity, non-breaking
5. **Update codemod** — support migration path

---

## Testing Strategy

1. **Unit tests** for all native utility replacements
2. **Visual regression tests** for tailwind-merge replacement
3. **Bundle size CI checks** to prevent regressions
4. **E2E tests** to verify tools work correctly when imported from new entry points
5. **i18n tests** to verify lazy-loading works correctly for all locales
