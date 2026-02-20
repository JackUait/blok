# Table Cell Line Breaks — Separate Paragraph Blocks

## Problem

When pasting a table from Google Docs, line breaks within cells are lost. A cell containing:

```
test 3
test 4
test 5
```

Pastes as `test 3test 4test 5` (concatenated, no breaks).

## Root Cause

Google Docs represents line breaks within table cells as `<p>` tags:

```html
<td><p>test 3</p><p>test 4</p><p>test 5</p></td>
```

The first `clean()` call in `getDataForHandler()` (paste/index.ts:212) uses a sanitizer config that does NOT include `p`. HTML Janitor unwraps `<p>` tags (removes tag, keeps content), producing:

```html
<td>test 3test 4test 5</td>
```

Line breaks are gone before `HtmlHandler` or the table tool ever see the content.

The grid-paste path (`sanitizeCellHtml` in `table-cell-clipboard.ts`) already handles this by converting `<p>` to `<br>` before sanitization. But the editor-level paste path does not.

## Design

Convert `<p>` boundaries to `<br>` within table cells in the Google Docs preprocessor (before sanitization), then split by `<br>` to create separate paragraph blocks per line in both paste paths.

### Changes

**1. `google-docs-preprocessor.ts`** — Add `convertTableCellParagraphs()`:

Find all `<td>` and `<th>` elements. Within each, replace `<p>...</p>` with `...<br>`. `<br>` is in the sanitizer config (`{ br: {} }`), so it survives `clean()`.

**2. `table-cell-blocks.ts` `initializeCells()`** — Split string cells by `<br>`:

When handling a string cell (legacy or pasted), split by `<br>` regex. Create a separate paragraph block for each segment. Handles the editor-level paste path where `onPaste` passes `string[][]`.

**3. `table-cell-clipboard.ts` `parseGenericHtmlTable()`** — Split into multiple blocks:

After `sanitizeCellHtml()` produces `"test 3<br>test 4<br>test 5"`, split by `<br>`. Create a `ClipboardBlockData` per segment instead of one per cell. Handles the grid-paste path.

### Data Flow

**Editor-level paste:**
```
Google Docs: <td><p>test 3</p><p>test 4</p><p>test 5</p></td>
→ Preprocessor: <td>test 3<br>test 4<br>test 5</td>
→ clean(): <td>test 3<br>test 4<br>test 5</td>  (br survives)
→ onPaste: cell.innerHTML = "test 3<br>test 4<br>test 5"
→ initializeCells: splits by <br> → 3 paragraph blocks
```

**Grid-paste:**
```
→ sanitizeCellHtml: "test 3<br>test 4<br>test 5"
→ parseGenericHtmlTable: splits → 3 ClipboardBlockData
→ pasteCellPayload: creates 3 paragraph blocks
```
