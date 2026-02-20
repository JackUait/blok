# Table Cell Line Breaks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve line breaks within table cells when pasting from Google Docs, creating separate paragraph blocks per line.

**Architecture:** Convert `<p>` boundaries to `<br>` in the Google Docs preprocessor (before sanitization), then split by `<br>` to create separate paragraph blocks in both the editor-level paste path (`initializeCells`) and the grid-paste path (`parseGenericHtmlTable`).

**Tech Stack:** TypeScript, DOM API, Vitest

---

### Task 1: Add `<p>` → `<br>` conversion for table cells in preprocessor

**Files:**
- Modify: `src/components/modules/paste/google-docs-preprocessor.ts:13-21`
- Modify: `test/unit/components/modules/paste/google-docs-preprocessor.test.ts`

**Step 1: Write the failing test**

Add these tests at the end of the existing `describe('preprocessGoogleDocsHtml')` block in `test/unit/components/modules/paste/google-docs-preprocessor.test.ts`:

```typescript
  it('converts <p> boundaries to <br> inside table cells', () => {
    const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<td>line one<br>line two</td>');
    expect(result).not.toContain('<p>');
  });

  it('converts <p> boundaries to <br> inside <th> cells', () => {
    const html = '<table><tr><th><p>header one</p><p>header two</p></th></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<th>header one<br>header two</th>');
  });

  it('does not leave trailing <br> after last paragraph in cell', () => {
    const html = '<table><tr><td><p>only line</p></td></tr></table>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toMatch(/<br>\s*<\/td>/);
    expect(result).toContain('only line');
  });

  it('does not convert <p> outside of table cells', () => {
    const html = '<p>standalone paragraph</p>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toBe('<p>standalone paragraph</p>');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/components/modules/paste/google-docs-preprocessor.test.ts`

Expected: The 4 new tests FAIL because `convertTableCellParagraphs` does not exist yet; `<p>` tags inside `<td>` pass through unchanged.

**Step 3: Write minimal implementation**

In `src/components/modules/paste/google-docs-preprocessor.ts`, add a call to `convertTableCellParagraphs(wrapper)` in the main function (between `convertGoogleDocsStyles` and the return), and add the new function at the bottom of the file:

Add to `preprocessGoogleDocsHtml` (after line 19):
```typescript
  convertTableCellParagraphs(wrapper);
```

Add as a new function at the end of the file:
```typescript
/**
 * Convert `<p>` boundaries to `<br>` line breaks inside table cells.
 *
 * Google Docs wraps each line in a cell as a separate `<p>`.  The sanitizer
 * strips `<p>` (not in the allowed config), losing line breaks.  Converting
 * to `<br>` preserves them since `<br>` IS in the config (`{ br: {} }`).
 *
 * Only targets `<td>` and `<th>` elements — top-level `<p>` tags are left
 * intact so the paste pipeline can split them into separate blocks.
 */
function convertTableCellParagraphs(wrapper: HTMLElement): void {
  for (const cell of Array.from(wrapper.querySelectorAll('td, th'))) {
    const paragraphs = cell.querySelectorAll('p');

    if (paragraphs.length === 0) {
      continue;
    }

    for (const p of Array.from(paragraphs)) {
      const fragment = document.createRange().createContextualFragment(p.innerHTML + '<br>');

      p.replaceWith(fragment);
    }

    // Remove trailing <br> from the cell
    cell.innerHTML = cell.innerHTML.replace(/(<br\s*\/?>|\s)+$/i, '');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/components/modules/paste/google-docs-preprocessor.test.ts`

Expected: ALL tests pass (including existing ones).

**Step 5: Commit**

```bash
git add src/components/modules/paste/google-docs-preprocessor.ts test/unit/components/modules/paste/google-docs-preprocessor.test.ts
git commit -m "fix(paste): convert <p> to <br> in table cells before sanitization

Google Docs wraps each line in a table cell as a <p> tag. The sanitizer
strips <p> (not in the allowed config), losing line breaks. Converting
to <br> before sanitization preserves them."
```

---

### Task 2: Split `<br>` into multiple paragraph blocks in `initializeCells`

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts:269-276`
- Modify: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write the failing test**

Add a new test inside the existing `describe('initializeCells')` block in `test/unit/tools/table/table-cell-blocks.test.ts` (after the existing "should migrate legacy string content to paragraph blocks" test, around line 1571):

```typescript
    it('should split string cells with <br> into multiple paragraph blocks', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      let callCount = 0;
      const mockInsert = vi.fn().mockImplementation(() => {
        callCount++;

        return {
          id: `block-${callCount}`,
          holder: document.createElement('div'),
        };
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement,
        tableBlockId: 'table-1',
      });

      const result = cellBlocks.initializeCells([['line one<br>line two<br>line three']]);

      expect(mockInsert).toHaveBeenCalledTimes(3);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line one' }, expect.anything(), 1, false);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line two' }, expect.anything(), 1, false);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'line three' }, expect.anything(), 1, false);
      expect(result[0][0]).toEqual({ blocks: ['block-1', 'block-2', 'block-3'] });
    });

    it('should keep single-line string cells as one paragraph block', async () => {
      const { TableCellBlocks, CELL_BLOCKS_ATTR } = await import('../../../../src/tools/table/table-cell-blocks');

      const mockBlockHolder = document.createElement('div');
      const mockInsert = vi.fn().mockReturnValue({
        id: 'single-1',
        holder: mockBlockHolder,
      });

      const api = {
        blocks: { insert: mockInsert, getBlocksCount: vi.fn().mockReturnValue(1), setBlockParent: vi.fn() },
        events: { on: vi.fn(), off: vi.fn() },
      } as unknown as API;

      const gridElement = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      cell.appendChild(container);
      row.appendChild(cell);
      gridElement.appendChild(row);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement,
        tableBlockId: 'table-1',
      });

      const result = cellBlocks.initializeCells([['no line breaks']]);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith('paragraph', { text: 'no line breaks' }, expect.anything(), 1, false);
      expect(result[0][0]).toEqual({ blocks: ['single-1'] });
    });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/tools/table/table-cell-blocks.test.ts`

Expected: The "should split string cells with <br>" test FAILS because `initializeCells` currently creates one block with the full `"line one<br>line two<br>line three"` string. It calls `insert` once, not three times.

**Step 3: Write minimal implementation**

In `src/tools/table/table-cell-blocks.ts`, replace lines 269-275 (the `else` branch that handles string content):

Replace:
```typescript
        } else {
          const text = typeof cellContent === 'string' ? cellContent : '';
          const block = this.api.blocks.insert('paragraph', { text }, {}, this.api.blocks.getBlocksCount(), false);

          container.appendChild(block.holder);
          this.api.blocks.setBlockParent(block.id, this.tableBlockId);
          normalizedRow.push({ blocks: [block.id] });
        }
```

With:
```typescript
        } else {
          const text = typeof cellContent === 'string' ? cellContent : '';
          const segments = text.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
          const textsToInsert = segments.length > 0 ? segments : [text];
          const ids: string[] = [];

          for (const segmentText of textsToInsert) {
            const block = this.api.blocks.insert('paragraph', { text: segmentText }, {}, this.api.blocks.getBlocksCount(), false);

            container.appendChild(block.holder);
            this.api.blocks.setBlockParent(block.id, this.tableBlockId);
            ids.push(block.id);
          }

          normalizedRow.push({ blocks: ids });
        }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/tools/table/table-cell-blocks.test.ts`

Expected: ALL tests pass (including existing ones).

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-blocks.ts test/unit/tools/table/table-cell-blocks.test.ts
git commit -m "feat(table): split <br> in string cells into separate paragraph blocks

When initializeCells receives a string cell with <br> tags (from
pasted content), split into multiple paragraph blocks. Each line
becomes its own block within the cell."
```

---

### Task 3: Split sanitized cell content into multiple blocks in `parseGenericHtmlTable`

**Files:**
- Modify: `src/tools/table/table-cell-clipboard.ts:210-215`
- Modify: `test/unit/tools/table/table-cell-clipboard.test.ts`

**Step 1: Update the existing test to expect multiple blocks**

The existing test at line 419 asserts one block with `<br>`:

```typescript
    it('should convert paragraph boundaries to line breaks', () => {
      const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks[0].data.text).toBe('line one<br>line two');
    });
```

Replace it with a test that expects separate blocks:

```typescript
    it('should split paragraph boundaries into separate blocks', () => {
      const html = '<table><tr><td><p>line one</p><p>line two</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks).toHaveLength(2);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('line one');
      expect(result?.cells[0][0].blocks[1].data.text).toBe('line two');
    });
```

Also add a new test for single-line cells:

```typescript
    it('should produce one block for single-paragraph cells', () => {
      const html = '<table><tr><td><p>only line</p></td></tr></table>';
      const result = parseGenericHtmlTable(html);

      expect(result?.cells[0][0].blocks).toHaveLength(1);
      expect(result?.cells[0][0].blocks[0].data.text).toBe('only line');
    });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/tools/table/table-cell-clipboard.test.ts`

Expected: "should split paragraph boundaries into separate blocks" FAILS because `parseGenericHtmlTable` still produces one block with `<br>` inside.

**Step 3: Write minimal implementation**

In `src/tools/table/table-cell-clipboard.ts`, replace lines 210-215 inside `parseGenericHtmlTable`:

Replace:
```typescript
    tds.forEach((td) => {
      const text = sanitizeCellHtml(td);

      rowCells.push({
        blocks: [{ tool: 'paragraph', data: { text } }],
      });
    });
```

With:
```typescript
    tds.forEach((td) => {
      const text = sanitizeCellHtml(td);
      const segments = text.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
      const blocks = segments.length > 0
        ? segments.map(s => ({ tool: 'paragraph' as const, data: { text: s } }))
        : [{ tool: 'paragraph' as const, data: { text: '' } }];

      rowCells.push({ blocks });
    });
```

Also update the JSDoc for `parseGenericHtmlTable` (line 175) from "Each `<td>`/`<th>` becomes a single paragraph block" to "Each `<td>`/`<th>` becomes one or more paragraph blocks (split by line breaks)".

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/tools/table/table-cell-clipboard.test.ts`

Expected: ALL tests pass. Check that the "should not leave trailing br tags" test (line 451) still passes.

**Step 5: Commit**

```bash
git add src/tools/table/table-cell-clipboard.ts test/unit/tools/table/table-cell-clipboard.test.ts
git commit -m "feat(table): split multi-line cells into separate paragraph blocks in grid-paste

parseGenericHtmlTable now creates one ClipboardBlockData per line
instead of a single block with <br> for the grid-paste path."
```

---

### Task 4: Run lint and full test suite

**Step 1: Run lint**

Run: `npx eslint src/components/modules/paste/google-docs-preprocessor.ts src/tools/table/table-cell-blocks.ts src/tools/table/table-cell-clipboard.ts`

Expected: No lint errors. Fix any that appear.

**Step 2: Run full unit test suite**

Run: `npx vitest run`

Expected: All tests pass. No regressions.

**Step 3: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix: resolve lint errors from line break changes"
```
