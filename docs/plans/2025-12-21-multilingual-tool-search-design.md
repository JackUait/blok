# Multilingual Tool Search Design

## Overview

Enable users to search for tools in the toolbox using:
1. Their current language (displayed title)
2. English (automatic fallback)
3. Tool-defined aliases (e.g., "h1", "title")

## User Experience

A French user types `/h1`:
- "Titre 1" (displayed) - no match
- "Heading 1" (English) - no match
- `searchTerms: ["h1", ...]` - **match**

The Header tool appears in results.

## Tool Configuration

### Library-defined searchTerms

Tools define aliases via the `toolbox` static getter:

```typescript
class HeaderTool {
  static get toolbox() {
    return {
      title: 'Heading',
      titleKey: 'toolNames.heading',
      icon: '<svg>...</svg>',
      searchTerms: ['h1', 'h2', 'h3', 'title', 'header'],
    };
  }
}
```

### User-provided searchTerms (supplemental)

Users can add additional terms via Blok config. These **merge** with library terms, never replace:

```typescript
new Blok({
  tools: {
    header: {
      class: Header,
      searchTerms: ['titre', 'überschrift'],  // Adds to library terms
    }
  }
});
```

Resulting searchable terms:
- Displayed title (translated)
- English title ("Heading")
- Library terms: `['h1', 'h2', 'h3', 'title', 'header']`
- User terms: `['titre', 'überschrift']`

## Implementation

### 1. Type Definitions

Add `searchTerms` to toolbox config type in `types/tools/block-tool.d.ts`:

```typescript
interface ToolboxConfig {
  title?: string;
  titleKey?: string;
  icon?: string;
  searchTerms?: string[];  // NEW
}
```

Add to tool config in `types/configs/tool-config.d.ts`:

```typescript
interface ToolConfig {
  class: BlockToolConstructable;
  config?: object;
  searchTerms?: string[];  // NEW - user-provided, merged with library terms
}
```

### 2. I18n Module

Add method to fetch English translations in `src/components/modules/i18n.ts`:

```typescript
public getEnglishTranslation(key: string): string {
  return englishMessages[key] || '';
}
```

English messages are already bundled (not lazy-loaded), so this adds no overhead.

### 3. PopoverItemParams

Extend the type in `src/components/utils/popover/popover-item.ts`:

```typescript
interface PopoverItemParams {
  title?: string;
  englishTitle?: string;    // NEW
  searchTerms?: string[];   // NEW
  // ... existing properties
}
```

### 4. Toolbox

When building popover items in `src/components/ui/toolbox.ts`:

1. Get the tool's `searchTerms` from library definition
2. Get user-provided `searchTerms` from config
3. Merge both arrays (deduplicate)
4. Fetch English title via `i18n.getEnglishTranslation(titleKey)`
5. Pass `searchTerms` and `englishTitle` to popover item

### 5. PopoverDesktop Filter

Update `filterItems()` in `src/components/utils/popover/popover-desktop.ts`:

```typescript
public override filterItems(query: string): void {
  const lowerQuery = query.toLowerCase();

  const matchingItems = this.itemsDefault.filter(item => {
    const title = item.title?.toLowerCase() || '';
    const englishTitle = item.englishTitle?.toLowerCase() || '';
    const searchTerms = item.searchTerms || [];

    return title.includes(lowerQuery) ||
           englishTitle.includes(lowerQuery) ||
           searchTerms.some(term => term.toLowerCase().includes(lowerQuery));
  });

  this.onSearch({
    query,
    items: matchingItems,
  });
}
```

### 6. Built-in Tools

Add `searchTerms` to bundled tools:

**Paragraph:**
```typescript
searchTerms: ['text', 'p', 'paragraph']
```

**Header:**
```typescript
searchTerms: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title', 'header']
```

**List:**
```typescript
// Bulleted
searchTerms: ['ul', 'bullet', 'unordered']

// Numbered
searchTerms: ['ol', 'ordered', 'number']

// Todo
searchTerms: ['checkbox', 'task', 'todo', 'check']
```

## Files to Modify

- `types/tools/block-tool.d.ts` - Add searchTerms to ToolboxConfig
- `types/configs/tool-config.d.ts` - Add searchTerms to ToolConfig
- `src/components/modules/i18n.ts` - Add getEnglishTranslation method
- `src/components/utils/popover/popover-item.ts` - Add englishTitle and searchTerms
- `src/components/utils/popover/popover-desktop.ts` - Update filterItems logic
- `src/components/ui/toolbox.ts` - Pass searchTerms and englishTitle when building items
- `src/tools/paragraph/index.ts` - Add searchTerms
- `src/tools/header/index.ts` - Add searchTerms
- `src/tools/list/index.ts` - Add searchTerms

## Out of Scope

- Fuzzy matching or typo tolerance
- Search result ranking/scoring
- Changes to mobile popover behavior (inherits same item data)

## Testing

### Unit Tests
- Filter logic matches displayed title
- Filter logic matches English title
- Filter logic matches searchTerms aliases
- User searchTerms merge with library searchTerms (not replace)

### E2E Tests
- Search by English term when using non-English locale
- Search by alias (e.g., "h1" finds Heading)
- User-provided searchTerms work alongside library terms
