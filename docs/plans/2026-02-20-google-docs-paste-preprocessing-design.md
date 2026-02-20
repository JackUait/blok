# Google Docs Paste Preprocessing

## Problem

When pasting a table from Google Docs into Blok, bold, italic, and line breaks are lost. Only links survive.

## Root Cause

The paste module runs two sanitization passes on clipboard HTML. The first pass (`clean()` in `getDataForHandler()`, `src/components/modules/paste/index.ts:210`) strips all `<span>` tags because `span` is not in the sanitizer config. Google Docs encodes formatting as style-based spans (`<span style="font-weight:700">` for bold, `<span style="font-style:italic">` for italic).

The `convertGoogleDocsStyles()` method in `HtmlHandler.processHTML()` was added to convert these spans to semantic tags (`<b>`, `<i>`), but it runs AFTER the first sanitization pass. By that point, all spans are already stripped.

Links survive because `<a href>` is explicitly allowed in the sanitizer config (from the link inline tool).

Additionally, `unwrapGoogleDocsContent()` in `HtmlHandler.processHTML()` searches for `b[id^="docs-internal-guid-"]` to remove the Google Docs wrapper. But the first `clean()` pass strips the `id` attribute (config is `b: {}` which strips all attributes), making the selector fail silently.

## Solution

Extract Google Docs preprocessing into a standalone utility and run it BEFORE the first sanitization pass.

### Changes

**New file: `src/components/modules/paste/google-docs-preprocessor.ts`**

One public function: `preprocessGoogleDocsHtml(html: string): string`

1. Parse HTML string to DOM
2. Remove Google Docs `<b id="docs-internal-guid-...">` wrapper
3. Convert `<span style="font-weight:700|bold">` to `<b>`
4. Convert `<span style="font-style:italic">` to `<i>`
5. Serialize back to string

**Modify: `src/components/modules/paste/index.ts`**

In `getDataForHandler()`, preprocess before `clean()`:
```typescript
const preprocessed = preprocessGoogleDocsHtml(rawHtmlData);
const cleanData = clean(preprocessed, customConfig);
```

**Modify: `src/components/modules/paste/handlers/html-handler.ts`**

Remove `unwrapGoogleDocsContent()` and `convertGoogleDocsStyles()` methods and their calls in `processHTML()`. They are now handled upstream.

### What stays the same

- `sanitizeCellHtml()` in `table-cell-clipboard.ts` (grid-paste path receives raw clipboard HTML directly, not routed through the paste module)
- `Table.onPaste()` flow
- All sanitizer configs
- Everything outside the paste module

## Testing

- Unit tests for `preprocessGoogleDocsHtml()`: bold spans, italic spans, combined bold+italic, unwrapping, non-Google-Docs HTML passthrough
- Remove HtmlHandler tests for style conversion (no longer its responsibility)
- Existing table-cell-clipboard tests unchanged
