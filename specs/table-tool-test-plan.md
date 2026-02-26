# Blok Table Tool - Comprehensive Test Plan

## Application Overview

The Blok editor table tool is a full-featured block-based rich-text table. Each cell contains one or more nested block editors (supporting paragraph, list, and other block types). The table supports heading rows, heading columns, column resizing, row/column insertion and deletion via grip-pill popovers, drag-to-reorder rows and columns, click-and-drag cell selection, read-only rendering, paste from HTML, restricted block types inside cells, slash-menu access, keyboard navigation (Tab/Shift+Tab), and data save/load from JSON. The tool is configured via a TableConfig object and exposed as Blok.Table.

## Test Scenarios

### 1. Table Rendering and Initial State

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 1.1. Renders a default 3x3 table when inserted via slash menu with no data

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize the editor with the table tool registered (Blok.Table)
  2. Click the first empty paragraph block
  3. Type '/' to open the slash menu
  4. Type 'Table' in the search field
  5. Click the 'Table' entry in the toolbox
  6. Wait for the table block to appear in the editor

**Expected Results:**
  - A table block is inserted with 3 rows and 3 columns (default dimensions)
  - All 9 cells are visible and contain an empty paragraph block
  - Focus is placed in the first cell's editable area
  - No heading styles are applied by default

#### 1.2. Renders a table from saved data with correct cell content

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize the editor with table tool and pre-loaded data containing a 2x2 table with cells ['A','B','C','D']
  2. Wait for the editor to be ready

**Expected Results:**
  - The table block is visible
  - 4 cells are rendered (2 rows x 2 columns)
  - Cell text content matches: A, B, C, D

#### 1.3. Renders a table with heading row (first row styled distinctly)

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize the editor with table data where withHeadings is true and content is [['H1','H2'],['D1','D2']]
  2. Wait for the editor to be ready

**Expected Results:**
  - The first row has the data-blok-table-heading attribute
  - The first row appears visually distinct (e.g., bold, different background)

#### 1.4. Renders a table with heading column (first column styled distinctly)

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize the editor with table data where withHeadingColumn is true
  2. Wait for the editor to be ready

**Expected Results:**
  - The first cell in every row has the data-blok-table-heading-col attribute
  - The first column appears visually distinct from subsequent columns

#### 1.5. Renders column widths from saved colWidths data

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize editor with table data containing colWidths: [400, 200]
  2. Wait for the editor to be ready

**Expected Results:**
  - The first column renders at 400px wide
  - The second column renders at 200px wide
  - The table wrapper has overflow-x-auto scroll behavior enabled

#### 1.6. Table auto-initializes from empty content and saves as valid

**File:** `tests/tools/table/table-rendering.spec.ts`

**Steps:**
  1. Initialize an editor with a table block that has an empty content array
  2. Wait for the table block to render
  3. Call the editor save() method
  4. Inspect the saved blocks

**Expected Results:**
  - The rendered table auto-initializes to a default 3x3 grid
  - The table block is included in the saved output
  - The saved table data contains a non-empty content array
  - No error is thrown

### 2. Cell Editing

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 2.1. Types text into a table cell and text persists in saved data

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Click the contenteditable area inside the first cell
  3. Type 'Hello World'
  4. Call save() on the editor

**Expected Results:**
  - The text 'Hello World' is visible in the first cell
  - Saved data contains a paragraph block with text 'Hello World' referenced by the first cell's block ID

#### 2.2. Pressing Enter in a cell creates a new block within the same cell

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click into the first cell's editable area
  3. Type 'First line'
  4. Press Enter
  5. Type 'Second line'

**Expected Results:**
  - Both 'First line' and 'Second line' appear in the first cell
  - Focus remains in the first cell (not moved to next row)
  - The cell's blocks container holds two block elements

#### 2.3. Clicking blank space below block content in a cell focuses the last block

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Click on the cell element (not the contenteditable text area, but the cell background)
  3. Check which element has focus

**Expected Results:**
  - The contenteditable element of the last block in the cell receives focus
  - No JavaScript errors are thrown

#### 2.4. Cell placeholder is suppressed inside table cells when focused

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Click the first cell's editable area
  3. Inspect the CSS ::before pseudo-element content of the focused editable

**Expected Results:**
  - The ::before pseudo-element content is 'none' or empty (no placeholder text shown)
  - The data-blok-placeholder-active attribute is absent

#### 2.5. Cell placeholder is suppressed inside table cells when unfocused

**File:** `tests/tools/table/table-cell-editing.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Do not click into any cell
  3. Inspect the ::before pseudo-element content of the first cell's editable

**Expected Results:**
  - The ::before pseudo-element content is 'none' or empty for cells inside the table (no paragraph placeholder)

### 3. Keyboard Navigation

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 3.1. Tab key moves focus to the next cell in the same row

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table containing ['A','B','C','D']
  2. Click the first cell's contenteditable area
  3. Press Tab

**Expected Results:**
  - Focus moves to the second cell (B)
  - document.activeElement is inside the second cell

#### 3.2. Tab at the last column wraps focus to the first cell of the next row

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the last cell in the first row (second column)
  3. Press Tab

**Expected Results:**
  - Focus moves to the first cell of the second row
  - document.activeElement is inside row 2, column 1

#### 3.3. Tab at the very last cell of the table does nothing (no wrap to start)

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the last cell (row 2, column 2)
  3. Press Tab

**Expected Results:**
  - Focus does not jump outside the table or wrap back to the first cell
  - No error is thrown

#### 3.4. Shift+Tab moves focus to the previous cell

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the second cell (row 1, column 2)
  3. Press Shift+Tab

**Expected Results:**
  - Focus moves back to the first cell (row 1, column 1)

#### 3.5. Shift+Tab at the first column wraps focus to the last cell of the previous row

**File:** `tests/tools/table/table-keyboard-nav.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the first cell of the second row (row 2, column 1)
  3. Press Shift+Tab

**Expected Results:**
  - Focus moves to the last cell of the first row (row 1, column 2)

### 4. Column Resizing

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 4.1. Dragging a resize handle to the right expands the column width

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Locate the first data-blok-table-resize handle element
  3. Hover over the resize handle
  4. Press and hold the pointer button on the handle
  5. Drag 100px to the right
  6. Release the pointer

**Expected Results:**
  - The first column is wider by approximately 100px
  - The second column width is unchanged (independent resize)
  - The grid total width increases

#### 4.2. Dragging a resize handle to the left shrinks the column width

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Locate the first resize handle
  3. Drag the handle 100px to the left

**Expected Results:**
  - The first column is narrower by approximately 100px
  - The overall table width decreases

#### 4.3. Column widths are persisted to saved data after resizing

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table without pre-set colWidths
  2. Drag the first resize handle 100px to the right
  3. Call editor save()

**Expected Results:**
  - Saved data contains a colWidths array with 2 entries
  - The first colWidths value reflects the new wider width

#### 4.4. Resize handles are absent in read-only mode

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Toggle the editor to read-only mode via readOnly.toggle()
  3. Check for data-blok-table-resize elements

**Expected Results:**
  - No resize handle elements exist in the DOM
  - The table renders without interactive controls

#### 4.5. Loading a table with colWidths renders columns at exact pixel widths

**File:** `tests/tools/table/table-resize.spec.ts`

**Steps:**
  1. Initialize editor with table data containing colWidths: [400, 200]
  2. Measure the rendered column widths via getBoundingClientRect

**Expected Results:**
  - First column renders at 400px
  - Second column renders at 200px

### 5. Add Row and Column Controls

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 5.1. Add-row button becomes visible on hover near the bottom edge

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Move the mouse to within 40px of the bottom edge of the table grid
  3. Check visibility of the data-blok-table-add-row element

**Expected Results:**
  - The add-row button becomes visible (opacity transitions to 1)

#### 5.2. Clicking the add-row button appends a new empty row

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the bottom edge to reveal the add-row button
  3. Click the add-row button

**Expected Results:**
  - A third row is added to the table
  - The new row contains empty cells each with an empty paragraph block
  - The heading styles on the first row (if enabled) are maintained

#### 5.3. Add-column button becomes visible on hover near the right edge

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Move the mouse to within 40px of the right edge of the table grid
  3. Check visibility of the data-blok-table-add-col element

**Expected Results:**
  - The add-column button becomes visible

#### 5.4. Clicking the add-column button appends a new empty column

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the right edge to reveal the add-column button
  3. Click the add-column button

**Expected Results:**
  - Each row now has 3 cells
  - The new column cells each contain an empty paragraph block
  - The add-column button's tooltip shows the expected i18n text

#### 5.5. Dragging the add-row button downward adds multiple rows

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the bottom edge to reveal the add-row button
  3. Press and hold the pointer on the add-row button
  4. Drag downward by two row-heights
  5. Release the pointer

**Expected Results:**
  - Two new rows are appended to the table
  - The drag state is cleared on release
  - Normal click behavior is restored after drag

#### 5.6. Dragging the add-column button rightward adds multiple columns

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the right edge to reveal the add-column button
  3. Press and hold the pointer on the add-column button
  4. Drag rightward by two column-widths
  5. Release the pointer

**Expected Results:**
  - Two new columns are appended to the table
  - New columns have consistent widths (half the average of existing columns)

#### 5.7. Dragging add-column button leftward removes empty columns that were added

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Drag the add-column button rightward to add two columns
  3. Without releasing, drag leftward back past the original position

**Expected Results:**
  - The newly added columns are removed as the drag moves leftward
  - Non-empty columns are not deleted during drag

#### 5.8. Add controls are absent in read-only mode

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Toggle read-only mode via readOnly.toggle()
  3. Check for data-blok-table-add-row and data-blok-table-add-col elements

**Expected Results:**
  - Neither the add-row nor the add-column buttons exist in the DOM

#### 5.9. New row data is saved and editable

**File:** `tests/tools/table/table-add-controls.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover near the bottom edge and click the add-row button
  3. Click into the first cell of the new row
  4. Type 'NewContent'
  5. Call save()

**Expected Results:**
  - Saved data content array has 3 rows
  - Third row's first cell references a paragraph block containing 'NewContent'

### 6. Row and Column Grip Controls (Popover Menus)

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 6.1. Column grip pill appears when hovering a cell

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Hover the mouse over the first cell

**Expected Results:**
  - The column grip element (data-blok-table-grip-col) for column 0 becomes visible
  - The row grip element (data-blok-table-grip-row) for row 0 becomes visible
  - Grips are positioned at the top edge (col) and left edge (row) of the respective column/row

#### 6.2. Clicking a column grip opens a popover with column actions

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the first cell to show grips
  3. Click the column grip element

**Expected Results:**
  - A popover menu appears with: 'Insert Column Left', 'Insert Column Right', and 'Delete'
  - The popover does not contain 'Move Column Left' or 'Move Column Right' for a 2-column table
  - The column grip changes to its active (blue) state

#### 6.3. Clicking 'Insert Column Left' adds a column to the left

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click first cell, hover to show grips, click the first column grip
  3. Click 'Insert Column Left' in the popover

**Expected Results:**
  - Each row now has 3 cells
  - The new column is inserted at index 0 (leftmost)
  - The original column 0 content is now in column 1

#### 6.4. Clicking 'Insert Column Right' adds a column to the right

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Show column grip for column 0, click it to open popover
  3. Click 'Insert Column Right'

**Expected Results:**
  - Each row has 3 cells
  - The new column appears between column 0 and the old column 1

#### 6.5. Clicking column 'Delete' removes the column and redistributes widths

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Show column grip for column 0, click it
  3. Click 'Delete' in the popover

**Expected Results:**
  - The table now has 1 column per row
  - The remaining column takes the full width
  - No JavaScript errors occur

#### 6.6. Clicking a row grip opens a popover with row actions

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the first cell to show grips
  3. Click the row grip element

**Expected Results:**
  - A popover menu appears with: 'Insert Row Above', 'Insert Row Below', and 'Delete'
  - The popover does not contain 'Move Row Up' or 'Move Row Down' for a 2-row table
  - The row grip changes to its active state

#### 6.7. Clicking 'Insert Row Above' adds a row above the selected row

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Show row grip for row 0, click it to open popover
  3. Click 'Insert Row Above'

**Expected Results:**
  - Table now has 3 rows
  - The new row is at index 0
  - Original row 0 content is now in row 1

#### 6.8. Clicking 'Insert Row Below' adds a row below the selected row

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Show row grip for row 0, click it
  3. Click 'Insert Row Below'

**Expected Results:**
  - Table now has 3 rows
  - The new row is at index 1
  - Original row 1 content is now in row 2

#### 6.9. Clicking row 'Delete' removes the row

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table
  2. Show row grip for row 1, click it
  3. Click 'Delete'

**Expected Results:**
  - Table now has 2 rows
  - The deleted row's content is removed from saved data
  - The neighboring row's grip is highlighted to show context

#### 6.10. Column move options appear only when there are more than 2 columns

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table (3 columns)
  2. Show the column grip for column 1 (middle column)
  3. Click the grip to open the popover

**Expected Results:**
  - The popover contains 'Move Column Left' and 'Move Column Right' options
  - Column grip for column 0 does not show 'Move Column Left'
  - Column grip for the last column does not show 'Move Column Right'

#### 6.11. Row move options appear only when there are more than 2 rows

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x3 table (3 rows)
  2. Show the row grip for row 1 (middle row)
  3. Click the grip to open the popover

**Expected Results:**
  - The popover contains 'Move Row Up' and 'Move Row Down' options
  - Row 0 grip does not show 'Move Row Up'
  - Last row grip does not show 'Move Row Down'

#### 6.12. Toggle heading via row grip popover enables heading row styling

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table (withHeadings: false)
  2. Show row grip for row 0, click it
  3. Click the heading toggle option in the popover

**Expected Results:**
  - The first row gains the data-blok-table-heading attribute
  - Saved data has withHeadings: true

#### 6.13. Toggle heading column via column grip popover enables heading column styling

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table (withHeadingColumn: false)
  2. Show column grip for column 0, click it
  3. Click the heading column toggle option in the popover

**Expected Results:**
  - Every first cell in each row gains data-blok-table-heading-col attribute
  - Saved data has withHeadingColumn: true

#### 6.14. Grip pills are absent in read-only mode

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Toggle read-only mode
  3. Check for data-blok-table-grip elements

**Expected Results:**
  - No grip elements exist in the DOM
  - No add controls exist in the DOM
  - Cells are not contenteditable

#### 6.15. Grip popover reopens after being dismissed by a menu item click

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click cell, show row grip, open popover
  3. Click 'Insert Row Below' (popover dismisses)
  4. Hover a cell again
  5. Click the row grip again

**Expected Results:**
  - The popover reopens without errors
  - The new table structure (3 rows) is reflected in the popover context

#### 6.16. Grip pills have correct dimensions (col: 24x4, row: 4x20)

**File:** `tests/tools/table/table-grips.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click first cell to make grips visible
  3. Measure the bounding box of the column grip and row grip elements

**Expected Results:**
  - Column grip: width = 24px, height = 4px
  - Row grip: width = 4px, height = 20px

### 7. Drag-to-Reorder Rows and Columns

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 7.1. Dragging a row grip reorders rows

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table with content ['R1C1','R1C2','R2C1','R2C2','R3C1','R3C2']
  2. Hover over the first row to show the row grip
  3. Press and hold the row grip
  4. Drag downward past the second row
  5. Release the pointer

**Expected Results:**
  - Row 0's content appears at row 1 after the drag
  - The drag emits a 'move-row' action to the row/column action handler
  - After drag ends the grip is hidden and normal interaction resumes

#### 7.2. Dragging a column grip reorders columns

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with content ['A','B','C','D']
  2. Show the column grip for column 0
  3. Press and hold the column grip
  4. Drag rightward past column 1
  5. Release the pointer

**Expected Results:**
  - Column 0's content (A, C) appears in column 1 position
  - Column widths are updated in the colWidths array to match moved columns

#### 7.3. Add controls are hidden during grip drag

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Show the row grip
  3. Begin a drag (press and hold the grip, move beyond threshold)
  4. While dragging, check for add controls

**Expected Results:**
  - The add-row and add-column buttons are hidden (display: none) while dragging

#### 7.4. Resize is disabled during grip drag

**File:** `tests/tools/table/table-drag-reorder.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths
  2. Begin a grip drag
  3. Attempt to drag a resize handle during the grip drag

**Expected Results:**
  - The resize handle does not respond during the grip drag
  - Column widths are unchanged after the drag attempt

### 8. Cell Selection

**Seed:** `test/playwright/tests/tools/table-cell-selection-delete.spec.ts`

#### 8.1. Dragging across cells selects a rectangular range

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table with content ['A1'..'C3']
  2. Press and hold the pointer in cell (0,0)
  3. Drag to cell (1,1) while holding
  4. Release the pointer

**Expected Results:**
  - Cells (0,0), (0,1), (1,0), (1,1) have the data-blok-table-cell-selected attribute
  - Cells outside the rectangle are not selected
  - A blue selection border is visible around the selected rectangle

#### 8.2. Pressing Delete clears content of all selected cells

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table with content ['A1'..'C3']
  2. Drag to select cells (0,0) to (1,1) (4 cells)
  3. Press the Delete key

**Expected Results:**
  - All 4 selected cells become empty
  - Unselected cells retain their original content
  - Each cleared cell still contains an empty paragraph block (never truly empty)

#### 8.3. Pressing Backspace clears content of all selected cells

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table
  2. Select cells (0,0) to (1,1)
  3. Press Backspace

**Expected Results:**
  - All 4 selected cells are cleared
  - Unselected cells are unaffected

#### 8.4. Clicking a row grip selects the entire row

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table
  2. Hover to show row grip for row 1
  3. Click the row grip

**Expected Results:**
  - All 3 cells in row 1 have data-blok-table-cell-selected attribute
  - Cells in other rows are not selected
  - Add controls become non-interactive while selection is active

#### 8.5. Clicking a column grip selects the entire column

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table
  2. Hover to show column grip for column 0
  3. Click the column grip

**Expected Results:**
  - All 3 cells in column 0 have data-blok-table-cell-selected attribute
  - Cells in other columns are not selected

#### 8.6. Selection is cleared on primary pointerdown outside the table

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table and a paragraph block above it
  2. Drag to select a range of cells
  3. Trigger a primary-button pointerdown outside the table (for example on the paragraph block)

**Expected Results:**
  - data-blok-table-cell-selected attributes are removed from all cells after the outside pointerdown
  - Add controls and resize become interactive again

#### 8.7. Resize is disabled while cells are selected

**File:** `tests/tools/table/table-cell-selection.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths
  2. Drag to create a cell selection
  3. Attempt to drag a resize handle while the selection is active

**Expected Results:**
  - The resize handle does not respond while cells are selected
  - Column widths remain unchanged

### 9. Block Types Inside Table Cells

**Seed:** `test/playwright/tests/tools/table-any-block-type.spec.ts`

#### 9.1. Slash menu opens when typing '/' in a table cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table, paragraph, header, and list tools registered
  2. Click the first cell's editable area
  3. Type '/'

**Expected Results:**
  - The toolbox popover opens and is visible
  - The popover is positioned near the cursor (not at top-left 0,0)

#### 9.2. The 'Table' tool is hidden from the toolbox when inside a table cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table, header, paragraph, and list tools
  2. Click into a table cell and type '/'
  3. Inspect the toolbox items

**Expected Results:**
  - The 'Table' item is not visible in the toolbox popover
  - 'Paragraph' and 'List' items are visible and selectable

#### 9.3. The 'Header' tool is hidden from the toolbox when inside a table cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table, header, paragraph, and list tools
  2. Click into a table cell and type '/'
  3. Look for the 'Header' toolbox item

**Expected Results:**
  - The 'Header' item is not visible in the toolbox popover (default restricted tool)
  - The toolbox shows only non-restricted tools

#### 9.4. Selecting a list tool from the slash menu inserts a list in the cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table, paragraph, and list tools
  2. Click into the first cell and type '/'
  3. Click 'List' in the toolbox popover

**Expected Results:**
  - A list block appears inside the first cell
  - The cell now contains a list element
  - Other cells remain as paragraph blocks

#### 9.5. Markdown shortcut '- ' converts paragraph to list inside a cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table and list tools
  2. Click into the first cell
  3. Type '- Item'

**Expected Results:**
  - The cell contains a list block (data-blok-tool='list')
  - The list contains 'Item' as its first list item

#### 9.6. Pasting HTML list content creates a list block inside the cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table and list tools
  2. Click into the first cell to focus it
  3. Dispatch a paste event with clipboard HTML: '<ul><li>A</li><li>B</li></ul>'

**Expected Results:**
  - The cell contains at least one list block
  - The cell contains the text 'A'

#### 9.7. Pasting a restricted block type (header) into a cell converts it to paragraph

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with a header block and a table block
  2. Click the header block, select all text, copy it
  3. Click into the first table cell's editable area
  4. Paste the copied content

**Expected Results:**
  - The pasted content appears as a paragraph block, not a header block
  - No header block (data-blok-tool='header') exists inside the table cell

#### 9.8. Custom restricted tools configured via restrictedTools are hidden in cell toolbox

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with table tool configured with restrictedTools: ['list']
  2. Also register paragraph and list tools
  3. Click into a cell and type '/'

**Expected Results:**
  - The 'List' toolbox item is not visible in the popover
  - The 'Paragraph' item is still visible

#### 9.9. Multiple blocks can exist in a single cell

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Click the first cell's editable, type 'First line'
  3. Press Enter
  4. Type 'Second line'

**Expected Results:**
  - The first cell contains two block elements
  - Both 'First line' and 'Second line' are visible in the cell
  - The second cell is unaffected

#### 9.10. Each cell always has at least one empty paragraph block

**File:** `tests/tools/table/table-cell-blocks.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with empty cells
  2. Inspect the blocks container of each cell

**Expected Results:**
  - Every cell has a data-blok-table-cell-blocks container
  - Each container has exactly one block element (empty paragraph)
  - No contenteditable attributes appear on the cell element itself

### 10. Paste HTML Table into Editor

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 10.1. Pasting a valid HTML table replaces the current table block

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with a paragraph block and table tool registered
  2. Click the paragraph block to focus it
  3. Dispatch a paste event with a 2x2 HTML table: '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>'

**Expected Results:**
  - A table block is inserted with 2 rows and 2 columns
  - Cell content matches X, Y, Z, W

#### 10.2. Pasting an HTML table with a thead row enables heading row

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with table tool registered
  2. Dispatch a paste event with HTML: '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>D1</td><td>D2</td></tr></tbody></table>'

**Expected Results:**
  - The table is rendered with withHeadings: true
  - The first row has data-blok-table-heading attribute

#### 10.3. Pasting an HTML table with th elements in the first row enables heading row

**File:** `tests/tools/table/table-paste.spec.ts`

**Steps:**
  1. Initialize editor with table tool registered
  2. Dispatch a paste event with HTML: '<table><tr><th>H1</th><th>H2</th></tr><tr><td>D1</td><td>D2</td></tr></table>'

**Expected Results:**
  - withHeadings is set to true
  - The first row renders with heading styles

### 11. Read-Only Mode

**Seed:** `test/playwright/tests/tools/table-readonly.spec.ts`

#### 11.1. Table renders correctly in initial read-only mode

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize the editor in read-only mode (readOnly: true) with a 2x2 table containing ['A','B','C','D']
  2. Wait for the editor to be ready

**Expected Results:**
  - The table block is visible
  - Cell content A, B, C, D is rendered
  - Cells are not contenteditable
  - No grip, resize handle, or add-control elements are in the DOM
  - The wrapper has data-blok-table-readonly attribute

#### 11.2. Heading row is displayed in read-only mode

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in read-only mode with withHeadings: true
  2. Inspect the first row

**Expected Results:**
  - The first row has data-blok-table-heading attribute
  - Visual heading styling is applied

#### 11.3. Heading column is displayed in read-only mode

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in read-only mode with withHeadingColumn: true

**Expected Results:**
  - Each first cell has data-blok-table-heading-col attribute
  - Visual heading column styling is applied

#### 11.4. Toggling read-only mode removes interactive controls

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in edit mode with a 2x2 table
  2. Verify grips, add buttons, and resize handles exist
  3. Toggle read-only mode via readOnly.toggle()
  4. Check for interactive elements

**Expected Results:**
  - After toggling, no grip elements exist in the DOM
  - No add-row or add-column buttons exist
  - No resize handles exist
  - Cells become non-editable

#### 11.5. Blocks inside cells render correctly in read-only mode

**File:** `tests/tools/table/table-readonly.spec.ts`

**Steps:**
  1. Initialize editor in read-only mode with a table containing block-based cell data
  2. Inspect cells for rendered block content

**Expected Results:**
  - Cell blocks containers are present
  - Block content is visible and readable
  - No contenteditable attributes on blocks inside read-only cells

### 12. Data Save and Load

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 12.1. Save returns correct JSON structure for a table with content

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with content ['Name','Value','foo','bar'] and withHeadings: true
  2. Call editor.save()

**Expected Results:**
  - Output contains a block of type 'table'
  - table block data.withHeadings is true
  - data.content is a 2x2 array of objects each with a 'blocks' array
  - Each blocks array contains at least one block ID string
  - Sibling blocks in the output include paragraphs with text 'Name', 'Value', 'foo', 'bar'

#### 12.2. Column widths are preserved across save and re-load

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with a table containing colWidths: [400, 200]
  2. Call save()
  3. Destroy the editor and reinitialize with the saved data
  4. Measure column widths

**Expected Results:**
  - The first column remains 400px
  - The second column remains 200px

#### 12.3. Legacy string cell content is migrated to block format on load

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with table data where cells contain plain strings (legacy format): content: [['A','B'],['C','D']]
  2. Wait for the editor to be ready
  3. Call save()

**Expected Results:**
  - The rendered cells show A, B, C, D
  - Saved data converts cells to block-reference format with blocks arrays
  - Paragraph blocks containing A, B, C, D appear as sibling blocks in saved output

#### 12.4. Deleting the table block removes all associated cell blocks from saved data

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Type text into cells
  3. Select the table block and delete it (use editor API blocks.delete)
  4. Call save()

**Expected Results:**
  - No table block exists in saved output
  - No orphaned paragraph blocks (the cell's paragraph blocks) remain in saved output

#### 12.5. Adding a row via grip popover is reflected in saved data

**File:** `tests/tools/table/table-data.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Use the row grip popover to insert a row below row 0
  3. Call save()

**Expected Results:**
  - Saved data content has 3 rows
  - Each cell in the new row has an empty paragraph block reference

### 13. Toolbar Visibility in Table Cells

**Seed:** `test/playwright/tests/ui/table-toolbar-visibility.spec.ts`

#### 13.1. The plus button is hidden when a table cell is focused

**File:** `tests/tools/table/table-toolbar.spec.ts`

**Steps:**
  1. Initialize editor with a table block
  2. Click inside the first cell
  3. Wait 300ms for toolbar state to settle
  4. Check visibility of the settings toggler button

**Expected Results:**
  - The plus button (data-blok-testid='plus-button') is not visible
  - No JavaScript errors are thrown

#### 13.2. The settings toggler is hidden when a table cell is focused

**File:** `tests/tools/table/table-toolbar.spec.ts`

**Steps:**
  1. Initialize editor with a table block
  2. Click inside any table cell
  3. Check visibility of the settings toggler button

**Expected Results:**
  - The settings toggler (data-blok-testid='settings-toggler') is not visible

#### 13.3. The toolbar reappears after clicking outside the table

**File:** `tests/tools/table/table-toolbar.spec.ts`

**Steps:**
  1. Initialize editor with a paragraph block followed by a table block
  2. Click inside a table cell (toolbar hides)
  3. Click the paragraph block above the table

**Expected Results:**
  - The plus button becomes visible again when the paragraph is focused
  - The settings toggler becomes visible again

### 14. Table Configuration Options

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 14.1. Config rows and cols set the initial table dimensions

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with the table tool configured: { rows: 5, cols: 4 }
  2. Insert a table via slash menu

**Expected Results:**
  - The new table has 5 rows and 4 columns
  - All 20 cells are empty paragraphs

#### 14.2. Config withHeadings: true starts new tables with heading row enabled

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with table tool configured: { withHeadings: true }
  2. Insert a table via the slash menu

**Expected Results:**
  - The first row has data-blok-table-heading attribute without any user interaction
  - Saved data has withHeadings: true

#### 14.3. Config restrictedTools excludes specified tools from cell toolbox

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with table tool configured: { restrictedTools: ['list'] }
  2. Also register paragraph and list tools
  3. Insert a table, click into a cell, type '/' to open toolbox

**Expected Results:**
  - The 'List' item is absent or hidden in the toolbox popover
  - The 'Paragraph' item is visible

#### 14.4. Invalid colWidths (length mismatch with column count) is ignored on load

**File:** `tests/tools/table/table-config.spec.ts`

**Steps:**
  1. Initialize editor with table data where colWidths has 3 values but only 2 columns exist
  2. Wait for the editor to be ready

**Expected Results:**
  - No JavaScript error is thrown
  - The table renders with equal column widths (invalid colWidths are dropped)

### 15. Row and Column Grip Positioning

**Seed:** `test/playwright/tests/tools/table-row-grips-position.spec.ts`

#### 15.1. Column grips are positioned at the horizontal center of each column

**File:** `tests/tools/table/table-grip-positioning.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths: [200, 200]
  2. Click the first cell to reveal grips
  3. Measure the x-position of each column grip against the column center

**Expected Results:**
  - Each column grip's center-x is within 2px of the corresponding column's center x-coordinate

#### 15.2. Row grips are positioned at the vertical center of each row

**File:** `tests/tools/table/table-grip-positioning.spec.ts`

**Steps:**
  1. Initialize editor with a 3x2 table
  2. Hover to show row grips
  3. Measure the y-position of each row grip against the row center

**Expected Results:**
  - Each row grip's center-y is within 2px of the corresponding row's center y-coordinate

#### 15.3. Row grips reposition when a row height changes due to content growth

**File:** `tests/tools/table/table-grip-positioning.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table
  2. Note the initial y-position of the row grip for row 1
  3. Click row 0's cell and press Enter multiple times to grow its height
  4. Re-measure the y-position of row 1's grip

**Expected Results:**
  - The row 1 grip has moved down to remain at the vertical center of row 1
  - No JavaScript errors are thrown

#### 15.4. Column grips are not clipped by the table wrapper overflow after column insertion

**File:** `tests/tools/table/table-grip-positioning.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths: [300, 300]
  2. Insert a new column to the left via the grip popover
  3. Scroll the table wrapper to the leftmost position
  4. Click the newly inserted column's cell to show grips
  5. Measure the column grip bounding box and the wrapper bounding box

**Expected Results:**
  - The column grip's top edge is within the table wrapper's visible area (not clipped)
  - The grip is visible and interactive

#### 15.5. Row grips are not clipped by the table wrapper overflow after column insertion

**File:** `tests/tools/table/table-grip-positioning.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table with colWidths: [300, 300]
  2. Insert a column to the left via grip popover
  3. Scroll the table to the left
  4. Hover the second row's first cell to show the row grip
  5. Measure the row grip's x position against the wrapper left edge

**Expected Results:**
  - The row grip's left edge is within the table wrapper's visible area (not clipped)

### 16. Edge Cases and Error Handling

**Seed:** `test/playwright/tests/tools/table.spec.ts`

#### 16.1. Deleting the only column leaves the table in a clean state

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with a 2x1 table (2 rows, 1 column)
  2. Show the column grip for column 0
  3. Click the grip and select 'Delete'

**Expected Results:**
  - The table still renders with no columns
  - No uncaught JavaScript error is thrown
  - The editor save does not crash

#### 16.2. Deleting the only row leaves the table in a clean state

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with a 1x2 table (1 row, 2 columns)
  2. Show the row grip for row 0
  3. Click the grip and select 'Delete'

**Expected Results:**
  - The table is effectively empty
  - No uncaught JavaScript error is thrown

#### 16.3. Table destroy cleans up all cell blocks and event listeners

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with a 2x2 table and type content into cells
  2. Call window.blokInstance.destroy()
  3. Re-initialize the editor with a fresh empty state

**Expected Results:**
  - No errors are thrown during destroy
  - The new editor starts clean with no orphaned DOM from the previous instance
  - The previous cell blocks are not present in the new editor

#### 16.4. Consecutive column insertions from newly created column grips remain functional

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with a 3x3 table and colWidths: [200, 200, 200]
  2. Click first cell, show column grip, insert 'Column Right'
  3. After insertion, the new column's grip is locked active (blue)
  4. Dispatch pointerdown/pointerup/click on the active grip to reopen popover
  5. Insert 'Column Right' a second time
  6. Click outside to dismiss, then hover a cell to confirm grips work

**Expected Results:**
  - Table has 5 columns after two insertions
  - Grips are still functional (visible on hover) after the two insertions and dismiss
  - No JavaScript errors are thrown

#### 16.5. Table handles pasting the same content multiple times without duplicating cells

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with a table block
  2. Dispatch an onPaste event with a 2x2 HTML table
  3. Dispatch the same paste event again immediately

**Expected Results:**
  - Only one table block exists after both paste events
  - The table has the expected 2x2 cell structure

#### 16.6. Table renders without errors when saved data has no initialColWidth

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Initialize editor with table data that has colWidths but no initialColWidth field

**Expected Results:**
  - The table renders with the given colWidths
  - No JavaScript error is thrown
  - After adding a new column, the new column width is computed as half the average of existing columns

#### 16.7. Table grip controls do not throw errors after page error events are monitored

**File:** `tests/tools/table/table-edge-cases.spec.ts`

**Steps:**
  1. Attach a page error listener
  2. Initialize editor with a 2x2 table
  3. Perform: click cell, open grip popover, insert row, open grip again, delete row, open grip again
  4. Check the captured page errors list

**Expected Results:**
  - No page errors are captured during the sequence of operations
