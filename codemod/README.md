# EditorJS to Blok Codemod

Automatically migrate your codebase from EditorJS to Blok.

## Installation & Usage

### Using npx (recommended)

```bash
# Dry run (preview changes without modifying files)
npx @jackuait/blok-codemod ./src --dry-run

# Apply changes
npx @jackuait/blok-codemod ./src

# Process entire project
npx @jackuait/blok-codemod .

# Verbose output
npx @jackuait/blok-codemod ./src --verbose
```

### Global Installation

```bash
npm install -g @jackuait/blok-codemod
blok-codemod ./src
```

## What It Does

### Import Transformations

```diff
- import EditorJS from '@editorjs/editorjs';
+ import Blok from '@jackuait/blok';

- import Header from '@editorjs/header';
- import Paragraph from '@editorjs/paragraph';
+ // Header is now bundled with Blok: use Blok.Header
+ // Paragraph is now bundled with Blok: use Blok.Paragraph
```

### Type Transformations

```diff
- import type { EditorConfig } from '@editorjs/editorjs';
+ import type { BlokConfig } from '@jackuait/blok';
```

### Class Name Transformations

```diff
- const editor = new EditorJS({ ... });
+ const editor = new Blok({ ... });
```

### CSS Selector Transformations

```diff
- .codex-editor { }
+ .blok-editor { }

- .ce-block { }
+ [data-blok-testid="block-wrapper"] { }

- .ce-block--selected { }
+ [data-blok-selected="true"] { }

- .ce-toolbar { }
+ [data-blok-testid="toolbar"] { }
```

### Data Attribute Transformations

```diff
- document.querySelector('[data-id="abc123"]');
+ document.querySelector('[data-blok-id="abc123"]');

- document.querySelector('[data-item-name="bold"]');
+ document.querySelector('[data-blok-item-name="bold"]');
```

### Default Holder Transformation

```diff
- <div id="editorjs"></div>
+ <div id="blok"></div>

- holder: 'editorjs'
+ holder: 'blok'
```

### Tool Configuration Transformations

```diff
tools: {
-   header: Header,
-   paragraph: Paragraph,
+   header: Blok.Header,
+   paragraph: Blok.Paragraph,
}
```

### package.json Updates

```diff
{
  "dependencies": {
-   "@editorjs/editorjs": "^2.28.0",
-   "@editorjs/header": "^2.8.0",
-   "@editorjs/paragraph": "^2.11.0",
+   "@jackuait/blok": "latest"
  }
}
```

## Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without modifying files |
| `--verbose` | Show detailed output for each file |
| `--help` | Show help message |

## Supported File Types

- JavaScript: `.js`, `.jsx`
- TypeScript: `.ts`, `.tsx`
- Vue: `.vue`
- Svelte: `.svelte`
- HTML: `.html`
- CSS: `.css`, `.scss`, `.less`

## After Migration

1. **Install dependencies**: Run `npm install` or `yarn` to update your dependencies

2. **Review changes**: The codemod handles most common patterns, but review the changes for:
   - Custom tool implementations
   - Complex selector patterns
   - Dynamic string construction

3. **Update custom tools**: If you have custom tools, ensure they follow Blok's API:
   - Lifecycle hooks: `rendered()`, `updated()`, `removed()`, `moved()`
   - Use `data-blok-*` attributes

4. **Test thoroughly**: Run your test suite and manually verify the editor works correctly

5. **Check MIGRATION.md**: See the full [migration guide](../MIGRATION.md) for manual updates

## Programmatic Usage

```javascript
const {
  transformFile,
  updatePackageJson,
  applyTransforms,
} = require('@jackuait/blok-codemod');

// Transform a single file
const result = transformFile('/path/to/file.ts', false);
console.log(result.changes);

// Update package.json
const pkgResult = updatePackageJson('/path/to/package.json', false);
console.log(pkgResult.changes);
```

## Known Limitations

- Does not handle dynamic imports with variable paths
- Complex nested selectors may need manual adjustment
- Custom EditorJS plugins need manual migration
- String templates with EditorJS references need manual review

## Contributing

Found a pattern that should be transformed? Open an issue or PR on the [Blok repository](https://github.com/jackuait/blok).

## License

Apache-2.0
