# Blok Table Tool - Supplementary Test Plan (Additional Scenarios)

## Application Overview

The Blok editor table tool is a full-featured block-based rich-text table. Each cell contains one or more nested block editors. The existing test plan (specs/table-tool-test-plan.md) covers 16 scenarios with 95 tests across rendering, cell editing, keyboard navigation, column resizing, add row/column controls, row/column grip popovers, drag-to-reorder, cell selection, block types inside cells, HTML paste, read-only mode, data save/load, toolbar visibility, configuration, grip positioning, and edge cases. This supplementary plan documents additional scenarios discovered by deep source analysis that are NOT yet covered by the existing 95 tests. Key gaps identified: the cell selection pill popover (Clear Selection action), the delete button behavior when only one row or column remains in the table, the stretched table configuration option, the colWidths scroll overflow activation, Google Docs HTML paste handling, inline tools (bold, italic, link) applied to text inside table cells, Escape key behavior to dismiss the cell selection, the selection overlay visual element positioning, and behavior when table has both heading row and heading column simultaneously.

## Test Scenarios

### 1. Cell Selection Pill and Popover

**Seed:** `test/playwright/tests/tools/table-cell-selection-delete.spec.ts`

#### 1.1. Selection pill appears after dragging across cells and hovering the selection overlay

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table containing ['A1'..'C3'] using the table tool
  2. Drag from cell (0,0) to cell (1,1) to create a 2x2 cell selection
  3. Wait for the data-blok-table-cell-selected attributes to appear on all 4 cells
  4. Move the mouse over the visible blue selection overlay rectangle
  5. Wait 300ms for the pill element to appear
  6. Check for an element with the data-blok-table-selection-pill attribute

**Expected Results:**
  - A small pill element (data-blok-table-selection-pill) is visible on the selection overlay
  - The pill has a blue background color matching the selection border (#3b82f6)
  - The pill is positioned at the right-center edge of the selection overlay

#### 1.2. Clicking the selection pill opens a popover with a Clear Selection action

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table containing content
  2. Drag from cell (0,0) to cell (1,1) to create a selection
  3. Hover over the blue selection overlay to reveal the pill
  4. Click the pill element (data-blok-table-selection-pill) using pointerdown
  5. Wait for a popover to appear

**Expected Results:**
  - A popover appears with a 'Clear Selection' (or i18n equivalent) menu item
  - The popover is anchored near the pill element
  - No JavaScript errors occur during pill click

#### 1.3. Clicking Clear Selection in the pill popover clears cell content of selected cells

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table containing content in all cells
  2. Drag to select cells (0,0) to (1,1)
  3. Hover over the selection overlay to reveal the pill
  4. Click the pill to open the popover
  5. Click the 'Clear Selection' item in the popover

**Expected Results:**
  - All 4 selected cells become empty (text is removed)
  - Unselected cells (row 2, column 2) retain their content
  - The selection is cleared and no cells have data-blok-table-cell-selected attribute
  - Each cleared cell still contains an empty paragraph block

#### 1.4. Pressing Escape key clears an active cell selection

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table containing content
  2. Drag from cell (0,0) to cell (2,2) to select all 9 cells
  3. Verify all 9 cells have data-blok-table-cell-selected attribute
  4. Press the Escape key
  5. Check for data-blok-table-cell-selected attributes

**Expected Results:**
  - After pressing Escape, all cells lose the data-blok-table-cell-selected attribute
  - Cell content is preserved (Escape only clears selection highlight, not content)
  - The selection overlay rectangle is no longer visible

#### 1.5. Selection overlay is an absolutely positioned element with blue border

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table containing content
  2. Drag from cell (0,0) to cell (1,1) to create a selection
  3. Query the DOM for an absolutely positioned div inside the table grid
  4. Measure the overlay element's bounding box
  5. Compare overlay bounds to the combined bounding box of the 4 selected cells

**Expected Results:**
  - An overlay element exists inside the table grid element after selection
  - The overlay's bounding box covers the exact rectangular area of selected cells
  - The overlay has a solid blue border (2px solid #3b82f6 or equivalent)

### 2. Delete Button Disabled State in Grip Popovers

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 2.1. Delete column button is disabled when only one column remains

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x1 table (2 rows, 1 column) with content ['A'] and ['B']
  2. Click the first cell to make grips visible
  3. Click the column grip (data-blok-table-grip-col) for column 0
  4. Inspect the Delete item in the column grip popover

**Expected Results:**
  - The Delete button in the column grip popover is rendered in a disabled state (visually dimmed or aria-disabled)
  - Clicking the disabled Delete button does not trigger a column deletion
  - The table still renders with 1 column after the click attempt

#### 2.2. Delete row button is disabled when only one row remains

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 1x2 table (1 row, 2 columns) with content ['A', 'B']
  2. Click the first cell to make grips visible
  3. Click the row grip (data-blok-table-grip-row) for row 0
  4. Inspect the Delete item in the row grip popover

**Expected Results:**
  - The Delete button in the row grip popover is rendered in a disabled state
  - Clicking the disabled Delete button does not trigger a row deletion
  - The table still renders with 1 row after the click attempt

#### 2.3. Heading toggle only appears in row grip popover for row 0

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table (3 rows, 2 columns)
  2. Click the first cell of row 1 (second row) to show grips
  3. Click the row grip for row 1 to open its popover
  4. Inspect the popover items for a heading toggle

**Expected Results:**
  - The heading toggle (Header row switch) is NOT present in the row 1 popover
  - The popover for row 1 contains only Insert Row Above, Insert Row Below, and Delete
  - Heading toggle only appears in the row 0 popover

#### 2.4. Heading column toggle only appears in column grip popover for column 0

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x3 table (2 rows, 3 columns)
  2. Click the second cell in the first row (column 1) to show grips
  3. Click the column grip for column 1 to open its popover
  4. Inspect the popover items for a heading toggle

**Expected Results:**
  - The heading toggle (Header column switch) is NOT present in the column 1 popover
  - The popover for column 1 contains only Insert Column Left, Insert Column Right, and Delete
  - Heading column toggle only appears in the column 0 popover

### 3. Combined Heading Row and Heading Column

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 3.1. Table with both heading row and heading column applies both styling attributes simultaneously

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize editor with table data: withHeadings: true, withHeadingColumn: true, content: [['H','Col1','Col2'],['Row1','A','B'],['Row2','C','D']]
  2. Wait for the editor to be ready and the table to render
  3. Inspect the first row for the data-blok-table-heading attribute
  4. Inspect the first cell of each row for the data-blok-table-heading-col attribute
  5. Inspect the first cell of the first row (top-left corner) for both attributes

**Expected Results:**
  - The first row (row 0) has the data-blok-table-heading attribute
  - Every first cell in each row has the data-blok-table-heading-col attribute
  - The top-left cell has both data-blok-table-heading (from row) and data-blok-table-heading-col (from column) applied
  - Other cells have neither attribute

#### 3.2. Toggling heading row off via grip does not remove heading column styling

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table having both withHeadings: true and withHeadingColumn: true
  2. Click the first cell to show grips
  3. Click the row grip for row 0
  4. Click the 'Header row' toggle to disable it
  5. Inspect the table attributes

**Expected Results:**
  - The data-blok-table-heading attribute is removed from the first row after toggling
  - The data-blok-table-heading-col attribute remains on the first cells of each row
  - Saved data has withHeadings: false and withHeadingColumn: true

#### 3.3. Toggling heading column off via grip does not remove heading row styling

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table having both withHeadings: true and withHeadingColumn: true
  2. Click the first cell to show grips
  3. Click the column grip for column 0
  4. Click the 'Header column' toggle to disable it
  5. Inspect the table attributes

**Expected Results:**
  - The data-blok-table-heading-col attribute is removed from the first cells after toggling
  - The data-blok-table-heading attribute remains on the first row
  - Saved data has withHeadings: true and withHeadingColumn: false

### 4. Table Scroll Overflow with Column Widths

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 4.1. Table wrapper gains overflow-x-auto class when colWidths are set

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table containing colWidths: [400, 200]
  2. Wait for the editor to render the table
  3. Inspect the table wrapper element (data-blok-tool='table') for its CSS classes or overflow style

**Expected Results:**
  - The table wrapper has overflow-x: auto (or overflow-x-auto class via Tailwind)
  - The wrapper allows horizontal scrolling when colWidths are wider than the viewport

#### 4.2. Table wrapper gains overflow-x-auto after dragging resize handle

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table without colWidths
  2. Verify the table wrapper does NOT have overflow-x-auto initially
  3. Locate the first resize handle (data-blok-table-resize)
  4. Press and hold the pointer on the handle and drag 200px to the right
  5. Release the pointer and inspect the table wrapper

**Expected Results:**
  - After resizing, the table wrapper gains overflow-x: auto or overflow-x-auto class
  - The table inner grid width has expanded to accommodate the wider column

#### 4.3. Table auto-scrolls to the right when a column is added via drag-add-column

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths: [300, 300]
  2. Hover near the right edge of the table to reveal the add-column button
  3. Press and hold the pointer on the add-column button
  4. Drag rightward by one column width to add a new column
  5. Release the pointer and check the wrapper scrollLeft position

**Expected Results:**
  - The table wrapper's scrollLeft is greater than 0 (scrolled to show the new column)
  - After release, the scroll position snaps back to 0 or remains at the right edge based on dragState.addedCols

### 5. Inline Tools (Bold, Italic, Link) Inside Table Cells

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 5.1. Selecting text in a table cell and applying bold formats the text

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table, paragraph tool, and any inline tools registered
  2. Click the first cell's contenteditable area
  3. Type 'Bold text'
  4. Select all text in the cell using Ctrl+A (or Cmd+A on Mac)
  5. Press Ctrl+B (or Cmd+B on Mac) to apply bold formatting
  6. Inspect the cell's contenteditable innerHTML

**Expected Results:**
  - The cell's editable area contains a <b> or <strong> element wrapping the selected text
  - The text 'Bold text' is still visible in the cell
  - No JavaScript errors occur

#### 5.2. Inline toolbar appears when text is selected inside a table cell

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the first cell's contenteditable area and type 'Hello World'
  3. Double-click the word 'Hello' to select it
  4. Wait 300ms for the inline toolbar to appear

**Expected Results:**
  - The inline toolbar becomes visible (data-blok-testid='inline-toolbar' or equivalent)
  - The inline toolbar contains Bold and Italic action buttons
  - The toolbar is positioned near the selected text

### 6. Table Configuration - Stretched Option

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 6.1. Table with stretched: true in saved data persists the stretched flag through save-load cycle

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with table data: withHeadings: false, stretched: true, content: [['A','B'],['C','D']]
  2. Wait for the editor to be ready
  3. Call editor.save() and inspect the saved table block data

**Expected Results:**
  - The saved table block data contains stretched: true
  - No JavaScript error occurs
  - The table renders correctly with the stretched flag preserved

#### 6.2. Config stretched: true passed via tool config is reflected in saved data for new tables

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with the table tool configured with config: { stretched: true }
  2. Click the first empty paragraph block
  3. Type '/' and click 'Table' in the slash menu to insert a new table
  4. Wait for the table to appear
  5. Call editor.save() and inspect the saved table block

**Expected Results:**
  - The saved table block has stretched: true in its data
  - The table is inserted with default 3x3 dimensions

### 7. Paste HTML Table - Additional Scenarios

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 7.1. Pasting an HTML table with colspan or rowspan attributes renders all text content

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with the table tool registered
  2. Click the first empty paragraph block to focus it
  3. Dispatch a paste event with HTML: '<table><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></table>'

**Expected Results:**
  - A table block is created without throwing a JavaScript error
  - The cell text 'Merged', 'A', 'B' are all present in the rendered table
  - The table does not crash even though colspan/rowspan are not natively supported

#### 7.2. Pasting an empty HTML table tag results in no table block being inserted

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with the table tool registered
  2. Click the first empty paragraph block to focus it
  3. Dispatch a paste event with HTML: '<table></table>'

**Expected Results:**
  - No table block with data-blok-tool='table' appears in the editor
  - No JavaScript error is thrown during the paste operation
  - The editor remains in a stable state (the original paragraph block is still present)

#### 7.3. Pasting an HTML table inside a table cell is handled without crashing

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table and the table tool registered
  2. Click the first cell's contenteditable area to focus it
  3. Dispatch a paste event with HTML: '<table><tr><td>Nested</td></tr></table>'

**Expected Results:**
  - No JavaScript error is thrown
  - The paste event is either ignored or handled gracefully (no nested table is created inside the cell)
  - The first cell retains its content or shows the text from the pasted table

### 8. Keyboard Navigation - Additional Edge Cases

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 8.1. Tab at the very last cell of the table does not move focus outside the table

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table and a paragraph block after it
  2. Click the last cell (row 1, column 1) in the 2x2 table
  3. Press the Tab key

**Expected Results:**
  - The active element (document.activeElement) does not move to the paragraph block after the table
  - Focus stays within the table or moves to a predictable position
  - No JavaScript error is thrown

#### 8.2. Shift+Tab at the very first cell of the table does not move focus outside the table

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a paragraph block before a 2x2 table
  2. Click the first cell (row 0, column 0) in the table
  3. Press Shift+Tab

**Expected Results:**
  - The active element does not move to the paragraph block before the table
  - Focus stays within the table
  - No JavaScript error is thrown

#### 8.3. Enter key in a table cell creates a new block within the cell, not a new row

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Click the first cell's contenteditable area
  3. Type 'Line one'
  4. Press Enter
  5. Type 'Line two'
  6. Count the total number of rows in the table

**Expected Results:**
  - The table still has exactly 2 rows (Enter does not add a table row)
  - The first cell contains both 'Line one' and 'Line two'
  - Focus remains in the first cell's blocks container

#### 8.4. Backspace at the start of the first block in a cell does not delete the cell or merge with the previous cell

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table containing ['A', 'B', 'C', 'D']
  2. Click the contenteditable of the first cell (cell with 'A')
  3. Press Home to move cursor to the beginning of 'A'
  4. Press Backspace

**Expected Results:**
  - The table still has 2 rows and 2 columns (no cell merging or deletion)
  - The text 'A' may be modified (first character deleted) but the cell remains
  - No JavaScript error occurs

### 9. Add Controls - Edge Cases

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 9.1. Add controls are not interactive when a cell selection is active

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table with content
  2. Drag to select cells (0,0) to (1,1) creating an active selection
  3. Verify selection is active (data-blok-table-cell-selected is present)
  4. Hover near the bottom edge of the table to try to reveal the add-row button
  5. Try to click the add-row button

**Expected Results:**
  - The add-row button either does not appear or is not clickable while selection is active
  - The table still has 3 rows after the click attempt
  - The selection remains active

#### 9.2. Add-row button tooltip shows 'Click to add row' and 'Drag to add or remove rows'

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the bottom edge of the table to make the add-row button visible
  3. Hover directly over the add-row button to trigger its tooltip
  4. Wait for the tooltip to appear

**Expected Results:**
  - A tooltip appears near the add-row button
  - The tooltip contains text about clicking to add a row
  - The tooltip also mentions dragging to add or remove rows

#### 9.3. Add-column button tooltip shows 'Click to add column' and 'Drag to add or remove columns'

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the right edge of the table to make the add-column button visible
  3. Hover directly over the add-column button to trigger its tooltip
  4. Wait for the tooltip to appear

**Expected Results:**
  - A tooltip appears near the add-column button
  - The tooltip contains text about clicking to add a column
  - The tooltip also mentions dragging to add or remove columns

### 10. Data Normalizer - Legacy and Edge Format Handling

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 10.1. Table with missing withHeadings field defaults to false

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with table data that omits the withHeadings field: content: [['A','B'],['C','D']]
  2. Wait for the editor to be ready
  3. Call editor.save() and inspect the table block's withHeadings field
  4. Inspect the DOM for any heading row attribute

**Expected Results:**
  - The table renders without any heading row styling
  - No data-blok-table-heading attribute exists on any row
  - Saved data has withHeadings: false

#### 10.2. Table with missing withHeadingColumn field defaults to false

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with table data that omits the withHeadingColumn field: content: [['A','B'],['C','D']]
  2. Wait for the editor to be ready
  3. Inspect the DOM for any heading column attribute

**Expected Results:**
  - No data-blok-table-heading-col attribute exists on any cell
  - Saved data has withHeadingColumn: false

#### 10.3. Table data normalizer handles undefined content gracefully

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with table data that contains no content field at all: { withHeadings: false }
  2. Wait for the editor to be ready
  3. Inspect the rendered table

**Expected Results:**
  - The editor does not throw a JavaScript error
  - The table tool renders with a default grid (3x3 or config-defined dimensions)
  - The editor save() call resolves successfully

### 11. Table Tool Toolbox Search Terms

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 11.1. Table tool is discoverable in the slash menu by searching 'grid'

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize editor with the table tool registered
  2. Click the first empty paragraph block
  3. Type '/' to open the slash menu
  4. Type 'grid' in the search field

**Expected Results:**
  - The 'Table' toolbox item remains visible in the search results
  - The item is not filtered out when searching for 'grid'

#### 11.2. Table tool is discoverable in the slash menu by searching 'spreadsheet'

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize editor with the table tool registered
  2. Click the first empty paragraph block
  3. Type '/' to open the slash menu
  4. Type 'spreadsheet' in the search field

**Expected Results:**
  - The 'Table' toolbox item remains visible in the search results
  - The item is not filtered out when searching for 'spreadsheet'

### 12. Drag Reorder - After Action Selection Highlighting

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 12.1. After drag-reordering a row, the moved row receives cell selection highlighting

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table with content ['R1C1','R1C2','R2C1','R2C2','R3C1','R3C2']
  2. Hover over the first row to show the row grip
  3. Press and hold the row grip for row 0
  4. Drag downward past the second row
  5. Release the pointer
  6. Inspect which cells have data-blok-table-cell-selected attribute

**Expected Results:**
  - After the drag, all cells in the moved row's new position have the data-blok-table-cell-selected attribute
  - The grip at the moved row's new position is in the active (blue) state
  - The row content was correctly reordered

#### 12.2. After drag-reordering a column, the moved column receives cell selection highlighting

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 2x3 table with content ['A','B','C','D','E','F']
  2. Hover over the first column's cell to show the column grip
  3. Press and hold the column grip for column 0
  4. Drag rightward past column 1
  5. Release the pointer
  6. Inspect which cells have data-blok-table-cell-selected attribute

**Expected Results:**
  - After the drag, all cells in the moved column's new position have the data-blok-table-cell-selected attribute
  - The column grip at the new position is in the active state
  - The column content was correctly reordered

### 13. Read-Only Mode - Content Verification

**Seed:** `test/playwright/tests/tools/table-readonly.spec.ts`

#### 13.1. Table in read-only mode renders cell block content as non-editable text

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in read-only mode (readOnly: true) with a 2x2 table containing block-format cells: content: [[{blocks:[]},{blocks:[]}],[{blocks:[]},{blocks:[]}]]
  2. Wait for the editor to be ready
  3. Inspect cells for contenteditable attributes
  4. Inspect cells for visible text content

**Expected Results:**
  - No element within the table has contenteditable='true'
  - Cell blocks containers (data-blok-table-cell-blocks) are present and visible
  - The wrapper has data-blok-table-readonly attribute

#### 13.2. Toggling from read-only back to edit mode restores interactive controls

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in edit mode with a 2x2 table
  2. Toggle read-only mode on via readOnly.toggle()
  3. Verify interactive elements (grips, resize, add controls) are removed
  4. Toggle read-only mode off via readOnly.toggle() again
  5. Hover over a cell and check for grip elements

**Expected Results:**
  - After toggling back to edit mode, grip elements appear on cell hover
  - Cells become contenteditable again
  - Add controls and resize handles are restored
  - No JavaScript errors occur during the toggle sequence

### 14. Table Accessibility

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 14.1. Table has no critical axe-core accessibility violations in edit mode

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table with content and withHeadings: true
  2. Inject axe-core into the page using injectAxe
  3. Run checkA11y targeting the table element (data-blok-tool='table')

**Expected Results:**
  - No critical or serious accessibility violations are reported by axe-core
  - The table renders in a way that screen readers can navigate it

#### 14.2. Table has no critical axe-core accessibility violations in read-only mode

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in read-only mode with a 2x2 table containing ['A','B','C','D'] and withHeadings: true
  2. Inject axe-core into the page using injectAxe
  3. Run checkA11y targeting the table element

**Expected Results:**
  - No critical or serious accessibility violations in read-only mode
  - The heading row structure is accessible
