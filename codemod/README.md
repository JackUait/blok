# EditorJS to Blok Codemod

Automatically migrate your codebase from EditorJS to Blok.

## Installation & Usage

### Using npx (recommended)

The codemod is bundled with the `@jackuait/blok` package.

```bash
# Dry run (preview changes without modifying files)
npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run

# Apply changes
npx -p @jackuait/blok migrate-from-editorjs ./src

# Process entire project
npx -p @jackuait/blok migrate-from-editorjs .

# Verbose output
npx -p @jackuait/blok migrate-from-editorjs ./src --verbose
```

### If you have @jackuait/blok installed locally

If you've already installed `@jackuait/blok` in your project, you can run the codemod directly:

```bash
npx migrate-from-editorjs ./src --dry-run
```

## What It Does

### Import Transformations

**EditorJS → Blok:**
```diff
- import EditorJS from '@editorjs/editorjs';
+ import { Blok } from '@jackuait/blok';

- import EditorJS, { EditorConfig } from '@editorjs/editorjs';
+ import { Blok, BlokConfig } from '@jackuait/blok';

- import Header from '@editorjs/header';
- import Paragraph from '@editorjs/paragraph';
- import List from '@editorjs/list';
+ import { Header, Paragraph, List } from '@jackuait/blok/tools';
```

**Blok default imports → named imports** (Blok only exports named exports):
```diff
- import Blok from '@jackuait/blok';
+ import { Blok } from '@jackuait/blok';

- import Editor from '@jackuait/blok';
+ import { Blok as Editor } from '@jackuait/blok';

- import Blok, { BlokConfig } from '@jackuait/blok';
+ import { Blok, BlokConfig } from '@jackuait/blok';
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

Old Blok static property references are converted to direct imports:
```diff
tools: {
-   header: Blok.Header,
-   paragraph: Blok.Paragraph,
-   list: Blok.List,
+   header: Header,
+   paragraph: Paragraph,
+   list: List,
}
```

Combined Blok imports are split into core and tools:
```diff
- import { Blok, Header, Paragraph, List } from '@jackuait/blok';
+ import { Blok } from '@jackuait/blok';
+ import { Header, Paragraph, List } from '@jackuait/blok/tools';
```

### package.json Updates

```diff
{
  "dependencies": {
-   "@editorjs/editorjs": "^2.28.0",
-   "@editorjs/header": "^2.8.0",
-   "@editorjs/paragraph": "^2.11.0",
-   "@editorjs/list": "^1.9.0",
+   "@jackuait/blok": "latest"
  }
}
```

## Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without modifying files |
| `--verbose` | Show detailed output for each file |
| `--use-library-i18n` | Remove custom i18n messages and use Blok's built-in translations |
| `--help` | Show help message |

### Using `--use-library-i18n`

If your EditorJS project had custom translations, the codemod will by default convert them to Blok's flat format. However, Blok now ships with built-in translations for 36 languages. If you prefer to use these library translations instead of maintaining your own, use the `--use-library-i18n` flag:

```bash
npx -p @jackuait/blok migrate-from-editorjs ./src --use-library-i18n
```

This will remove the `messages` property from your i18n config, allowing Blok to auto-detect the user's locale from the browser and use the appropriate built-in translations.

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
// If you've cloned the blok repository
const {
  transformFile,
  updatePackageJson,
  applyTransforms,
} = require('./codemod/migrate-editorjs-to-blok');

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
