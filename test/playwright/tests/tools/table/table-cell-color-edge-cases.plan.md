# Table Cell Color - Edge Cases and Interaction Test Plan

## Application Overview

This plan covers additional edge cases and interactions for the table cell color/marker feature in the Blok editor. The feature allows users to select table cells, trigger a pill popover, and apply background or text colors via a nested color picker. The tests focus on scenarios not covered by the existing suite: keyboard accessibility of the color picker, color persistence across structural table operations (add/delete row/column), color behavior during cell copy/paste, color rendering on initial page load from pre-existing data, independent coloring of multiple cells, tab-switching between text and background color modes, cell selection clearing behavior, and color picker dismissal patterns. All tests assume a fresh browser state with no prior editor data. The test page URL is http://localhost:3303/test/playwright/fixtures/test.html. Tests use the chromium-logic project (pure logic and API testing, browser-agnostic).

## Test Scenarios

### 1. Color Picker Keyboard Accessibility

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 1.1. Escape key closes color picker nested popover but keeps pill popover open

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table using the standard createBlok helper with content [['A1','B1','C1'],['A2','B2','C2'],['A3','B3','C3']] and wait for the table to be visible.
    - expect: The table is rendered with 9 cells.
  2. Click on cell (0,0) using mouse coordinates at the cell center to select it.
    - expect: The selection pill element with attribute data-blok-table-selection-pill is attached to the DOM.
  3. Hover over the pill to expand it, then click the pill to open the popover. Verify 'Copy', 'Clear', and 'Color' items are visible.
    - expect: The pill popover is open and shows the Copy, Clear, and Color menu items.
  4. Hover over the 'Color' menu item to trigger the nested color picker popover. Wait for the element with data-blok-testid='cell-color-picker' to be visible.
    - expect: The color picker nested popover appears to the right of the pill popover.
  5. Press the Escape key once on the keyboard.
    - expect: The color picker nested popover (data-blok-testid='cell-color-picker') is no longer visible.
    - expect: The parent pill popover remains open and the 'Color' item is still visible.
  6. Press the Escape key a second time.
    - expect: The parent pill popover is also closed and 'Copy' text is no longer visible.
    - expect: The cell selection remains (data-blok-table-cell-selected attribute is still present on cell (0,0)).

#### 1.2. Escape key closes entire popover tree when color picker is open

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and click on cell (0,0) to select it.
    - expect: Selection pill is attached.
  2. Hover the pill, click to open the popover, then hover the 'Color' item to open the color picker.
    - expect: Color picker is visible with data-blok-testid='cell-color-picker'.
  3. Press Escape once to close the color picker, then immediately press Escape again to close the parent popover.
    - expect: After two Escape presses, neither the color picker nor the pill popover is visible.
    - expect: Cell content 'A1' remains intact (verify via the contenteditable inside cell (0,0)).

#### 1.3. Tab key can navigate through pill popover items

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0) via mouse click.
    - expect: Selection pill is attached.
  2. Hover the pill to expand it, then click the pill to open the popover.
    - expect: Pill popover is open with Copy, Clear, and Color items visible.
  3. Press Tab key repeatedly (up to 5 times) and observe which element receives focus after each press.
    - expect: Focus moves through the popover items in sequence (Copy, Clear, Color).
    - expect: No JavaScript errors are thrown during keyboard navigation.

#### 1.4. Color swatch can be activated with Enter key after receiving focus

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0).
    - expect: Selection pill is attached.
  2. Open the pill popover by hovering and clicking the pill. Then hover the 'Color' item to open the color picker nested popover.
    - expect: Color picker is visible.
  3. Tab into the color picker until the orange swatch (data-blok-testid='cell-color-swatch-orange') receives focus, then press Enter.
    - expect: The orange color is applied to cell (0,0)'s backgroundColor style (style.backgroundColor is non-empty).
    - expect: OR if Tab navigation does not reach swatches in this implementation, clicking the swatch directly with force:true applies the color — document this as the expected keyboard interaction boundary.

#### 1.5. Tab key can switch between Background and Text color tabs in color picker

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0). Open the pill popover and hover Color to open the color picker.
    - expect: Color picker with data-blok-testid='cell-color-picker' is visible.
  2. Tab into the color picker area. Attempt to navigate to the Text Color tab (data-blok-testid='cell-color-tab-textColor') using the Tab key. Once the Text tab receives focus, press Enter or Space to activate it.
    - expect: The Text Color tab becomes active (the tab indicator changes).
    - expect: The color swatches update to reflect text color mode.
  3. Tab to the Background tab (data-blok-testid='cell-color-tab-backgroundColor') and activate it.
    - expect: The Background Color tab becomes active.
    - expect: Swatches show the background color mode options.

#### 1.6. Click outside color picker while it is open clears selection and closes all popovers

**File:** `test/playwright/tests/tools/table/table-cell-color-keyboard.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0). Open the pill popover and hover Color to reveal the color picker.
    - expect: Color picker is visible.
  2. Click at coordinates (10, 10) — far outside the table and any popover.
    - expect: The color picker nested popover is no longer visible.
    - expect: The pill popover is also closed.
    - expect: The cell selection is cleared: data-blok-table-cell-selected attribute is not present on any cell.

### 2. Color Persistence Across Structural Table Operations

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 2.1. Background color on a cell persists after adding a row below it via grip popover

**File:** `test/playwright/tests/tools/table/table-cell-color-structural.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table with content [['A1','B1','C1'],['A2','B2','C2'],['A3','B3','C3']].
    - expect: Table is visible with 3 rows.
  2. Select cell (0,0) by clicking its center. Hover the selection pill, click it to open the popover, hover 'Color' to open the color picker, then click the orange swatch (data-blok-testid='cell-color-swatch-orange') with force:true.
    - expect: Cell (0,0) has a non-empty backgroundColor style.
  3. Click outside the table at (10, 10) to clear the selection and close the popover.
    - expect: Pill popover is closed. Cell (0,0) still has backgroundColor set.
  4. Hover over the row 0 grip (data-blok-table-grip-row for the first row). Click the grip to open the row action popover. Click 'Add row below' or equivalent add-row action.
    - expect: A new row is inserted below row 0. The table now has 4 rows (data-blok-table-row count is 4).
  5. Inspect cell (0,0)'s backgroundColor style.
    - expect: Cell (0,0) backgroundColor is still non-empty (the color was not lost after the structural row insertion).
  6. Save the editor data using window.blokInstance.save() and inspect the content array.
    - expect: The first cell at content[0][0] has a 'color' property that is truthy.
    - expect: The new row at content[1] has no color properties on its cells.

#### 2.2. Background color on a cell persists after adding a column to the right via grip popover

**File:** `test/playwright/tests/tools/table/table-cell-color-structural.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table with labeled content.
    - expect: Table is visible with 3 columns.
  2. Select cell (0,1) (middle cell in first row). Open the color picker and apply the blue swatch.
    - expect: Cell (0,1) has a non-empty backgroundColor style.
  3. Click outside the table to clear the selection.
    - expect: Popover is closed and color is visible on cell (0,1).
  4. Hover over the column 1 grip (data-blok-table-grip-col for the second column). Click the grip to open the column action popover. Click 'Add column right' or equivalent add-column action.
    - expect: A new column is inserted after column 1. The table now has 4 columns.
  5. Inspect cell (0,1)'s backgroundColor style.
    - expect: Cell (0,1) backgroundColor is still non-empty.
  6. Inspect cell (0,2)'s backgroundColor style (the newly inserted column).
    - expect: Cell (0,2) has an empty backgroundColor style (new cells have no color).

#### 2.3. Color data in saved output is correct after deleting a colored row

**File:** `test/playwright/tests/tools/table/table-cell-color-structural.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table.
    - expect: Table is visible with 3 rows.
  2. Apply orange background color to cell (0,0) via the pill popover color picker.
    - expect: Cell (0,0) has a non-empty backgroundColor.
  3. Apply green background color to cell (1,0) via the pill popover color picker.
    - expect: Cell (1,0) has a non-empty backgroundColor.
  4. Click outside the table to close all popovers.
    - expect: Popovers are closed.
  5. Hover the row 0 grip to open its popover and delete row 0.
    - expect: Row 0 is removed. The table now has 2 rows. What was cell (1,0) is now cell (0,0).
  6. Save the editor data via window.blokInstance.save() and inspect the saved content array.
    - expect: content has 2 rows.
    - expect: The cell at content[0][0] (formerly row 1, now row 0) has a 'color' property that is truthy.
    - expect: There is no data for the deleted row 0.

#### 2.4. Color data in saved output is correct after deleting a colored column

**File:** `test/playwright/tests/tools/table/table-cell-color-structural.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table.
    - expect: Table is visible with 3 columns.
  2. Apply blue background color to cell (0,0) and orange background color to cell (0,2).
    - expect: Cell (0,0) and cell (0,2) each have non-empty backgroundColor styles.
  3. Click outside the table to clear selections.
    - expect: Popovers are closed.
  4. Hover the column 1 grip (middle column) and delete column 1.
    - expect: The middle column is removed. The table now has 2 columns. Cell (0,0) remains, and what was cell (0,2) is now cell (0,1).
  5. Save the editor data and inspect the content array.
    - expect: content[0] has 2 cells.
    - expect: content[0][0] has a 'color' property that is truthy.
    - expect: content[0][1] (formerly column 2) has a 'color' property that is truthy.
    - expect: The deleted column 1 is not present in saved data.

#### 2.5. Adding a row above a colored row does not affect color of existing rows

**File:** `test/playwright/tests/tools/table/table-cell-color-structural.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table.
    - expect: Table has 3 rows.
  2. Apply orange color to cell (1,0) (row 1, col 0).
    - expect: Cell (1,0) has a non-empty backgroundColor.
  3. Click outside the table to close the popover.
    - expect: Popover is closed.
  4. Hover the row 0 grip and add a row above row 0.
    - expect: A new blank row is inserted at position 0. The table now has 4 rows. What was row 1 is now row 2.
  5. Inspect the backgroundColor of cell (2,0) (the former row 1, col 0).
    - expect: Cell (2,0) backgroundColor is still non-empty (color was preserved after row insert above).
  6. Inspect the backgroundColor of the new row 0 cells.
    - expect: All cells in the new row 0 have empty backgroundColor styles.

### 3. Color Behavior with Cell Copy and Paste

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 3.1. Copying a colored cell and pasting preserves color data in the pasted destination

**File:** `test/playwright/tests/tools/table/table-cell-color-copy-paste.spec.ts`

**Steps:**
  1. Initialize the editor with a 4x4 table with content [['A1','B1','C1','D1'],['A2','B2','C2','D2'],['A3','B3','C3','D3'],['A4','B4','C4','D4']].
    - expect: Table is visible with 16 cells.
  2. Select cell (0,0) via mouse click. Open the pill popover and color picker, then apply orange background color to cell (0,0). Close the popover by clicking outside at (10,10).
    - expect: Cell (0,0) has a non-empty backgroundColor.
  3. Drag-select from cell (0,0) to cell (0,0) (single cell). Dispatch a synthetic copy event on document and capture the clipboard HTML using the performCopyAndCapture helper pattern (fake clipboardData.setData capturing).
    - expect: The captured HTML string contains a '<table' element and is non-empty.
  4. Click into the contenteditable inside cell (2,2) to place focus there.
    - expect: Cell (2,2) contenteditable is focused.
  5. Dispatch a synthetic paste event on the active element using the captured HTML and plain text.
    - expect: The paste completes without error.
  6. Inspect the backgroundColor style of cell (2,2) after paste.
    - expect: Cell (2,2) either has a non-empty backgroundColor (if colors are included in clipboard payload) OR has an empty backgroundColor if the current implementation does not transfer color metadata via copy/paste — document whichever behavior is observed as the expected outcome.
  7. Save the editor data and check content[2][2] for a 'color' property.
    - expect: The saved content[2][2] either has a 'color' property matching the orange color (if color is clipped) or has no 'color' property (if color is not copied) — whichever matches the actual behavior.

#### 3.2. Cutting a colored cell clears color from the source and removes it from saved data

**File:** `test/playwright/tests/tools/table/table-cell-color-copy-paste.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange background color to cell (0,0) via the pill popover. Click outside to close the popover.
    - expect: Cell (0,0) has a non-empty backgroundColor.
  2. Click on cell (0,0) to select it. Dispatch a synthetic cut event on document and capture the clipboard data.
    - expect: Cut event fires successfully. Clipboard HTML is non-empty.
  3. Inspect cell (0,0)'s backgroundColor style after the cut operation.
    - expect: Cell (0,0) has an empty backgroundColor style (the cut operation cleared both content and color).
  4. Save the editor data and inspect content[0][0].
    - expect: content[0][0] has no 'color' property OR its 'color' value is null/undefined/empty (the color was removed from the data model after cut).

#### 3.3. Pasting colored cells into a range overwrites target cells but does not affect non-paste-target cells

**File:** `test/playwright/tests/tools/table/table-cell-color-copy-paste.spec.ts`

**Steps:**
  1. Initialize the editor with a 4x4 table. Apply blue color to cell (0,0) and orange color to cell (0,1). Also apply green color to cell (3,3) (a cell not in the paste range).
    - expect: Cells (0,0), (0,1), and (3,3) have non-empty backgroundColor styles.
  2. Drag-select from cell (0,0) to cell (0,1) to select 2 cells. Dispatch a synthetic copy event and capture the clipboard.
    - expect: Clipboard HTML is non-empty.
  3. Click into the contenteditable of cell (2,0). Dispatch a synthetic paste event.
    - expect: Paste completes without error.
  4. Inspect backgroundColor of cell (3,3).
    - expect: Cell (3,3) still has a non-empty backgroundColor (the paste did not affect cells outside the paste target range).

### 4. Color Rendering on Initial Page Load from Pre-existing Data

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 4.1. Background color is applied to cells on initial render from saved data

**File:** `test/playwright/tests/tools/table/table-cell-color-initial-render.spec.ts`

**Steps:**
  1. Initialize the editor using createBlok with pre-existing table data that includes color properties on cells: content: [[{ blocks: [], color: '#f97316' }, 'B1', 'C1'], ['A2', 'B2', 'C2'], ['A3', 'B3', 'C3']]. Use withHeadings: false. Wait for the table to be visible.
    - expect: The table renders with 3 rows and 3 columns.
  2. Without any user interaction, inspect the backgroundColor style of cell (0,0).
    - expect: Cell (0,0) has a non-empty backgroundColor style that corresponds to the orange color (#f97316) specified in the initial data.
  3. Inspect the backgroundColor style of cell (0,1) and cell (0,2).
    - expect: Cells (0,1) and (0,2) have empty backgroundColor styles since they had no color in the initial data.

#### 4.2. Text color is applied to cells on initial render from saved data

**File:** `test/playwright/tests/tools/table/table-cell-color-initial-render.spec.ts`

**Steps:**
  1. Initialize the editor with table data where cell (1,1) has a textColor property: content: [['A1','B1','C1'],[{ blocks: [], textColor: '#3b82f6' },'B2','C2'],['A3','B3','C3']]. Wait for the table to be visible.
    - expect: Table is rendered with 9 cells.
  2. Inspect the color style of cell (1,0) without any interaction.
    - expect: Cell (1,0) has a non-empty color style (text color) corresponding to blue (#3b82f6).
  3. Inspect the color style of all other cells.
    - expect: All other cells have empty color styles.

#### 4.3. Both background and text color are applied correctly on initial render

**File:** `test/playwright/tests/tools/table/table-cell-color-initial-render.spec.ts`

**Steps:**
  1. Initialize the editor with table data where cell (0,0) has both color and textColor: content: [[{ blocks: [], color: '#f97316', textColor: '#3b82f6' }, 'B1', 'C1'], ['A2','B2','C2'], ['A3','B3','C3']]. Wait for the table to render.
    - expect: Table is rendered.
  2. Inspect both the backgroundColor and color styles of cell (0,0) immediately after render.
    - expect: Cell (0,0) backgroundColor is non-empty (maps to the orange color).
    - expect: Cell (0,0) color is non-empty (maps to the blue text color).
  3. Inspect cells (0,1) and all other cells.
    - expect: Cells without color data have empty backgroundColor and color styles.

#### 4.4. Color data survives a full save-then-reload cycle (save and re-initialize with saved data)

**File:** `test/playwright/tests/tools/table/table-cell-color-initial-render.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange background color to cell (0,0) via the pill popover.
    - expect: Cell (0,0) has a non-empty backgroundColor.
  2. Save the editor data using window.blokInstance.save() and capture the output as savedData.
    - expect: savedData.blocks[0].data.content[0][0].color is truthy.
  3. Destroy the current editor instance using window.blokInstance.destroy() and recreate the editor using createBlok with data: savedData (the previously saved output).
    - expect: Editor reinitializes successfully with the saved data. Table renders with 3 rows.
  4. Inspect the backgroundColor style of cell (0,0) after the re-initialization.
    - expect: Cell (0,0) still has a non-empty backgroundColor (the orange color survived the save-reload cycle).
  5. Inspect cells (0,1), (0,2), and all others.
    - expect: All other cells have empty backgroundColor styles.

### 5. Multiple Different Colors Across Different Cells

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 5.1. Different background colors can be applied to multiple individual cells independently

**File:** `test/playwright/tests/tools/table/table-cell-color-multi.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table.
    - expect: Table is visible.
  2. Apply orange background color to cell (0,0) via the pill popover: select cell (0,0), open pill, hover Color, click orange swatch. Click outside to close.
    - expect: Cell (0,0) has orange backgroundColor.
  3. Apply blue background color to cell (1,1) via the pill popover: select cell (1,1), open pill, hover Color, click blue swatch. Click outside to close.
    - expect: Cell (1,1) has blue backgroundColor.
  4. Apply red background color to cell (2,2) via the pill popover: select cell (2,2), open pill, hover Color, click red swatch. Click outside to close.
    - expect: Cell (2,2) has red backgroundColor.
  5. Inspect the backgroundColor styles of all 9 cells.
    - expect: Cell (0,0) has a non-empty backgroundColor.
    - expect: Cell (1,1) has a non-empty backgroundColor different from cell (0,0)'s.
    - expect: Cell (2,2) has a non-empty backgroundColor different from both.
    - expect: All remaining cells (0,1), (0,2), (1,0), (1,2), (2,0), (2,1) have empty backgroundColor styles.
  6. Save the editor data and inspect the content array.
    - expect: content[0][0].color is truthy and is not equal to content[1][1].color.
    - expect: content[1][1].color is truthy and is not equal to content[2][2].color.
    - expect: content[2][2].color is truthy.
    - expect: All other cell objects have no 'color' property or their 'color' is null/undefined.

#### 5.2. Applying different colors to all cells in a row individually works correctly

**File:** `test/playwright/tests/tools/table/table-cell-color-multi.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table.
    - expect: Table is visible.
  2. Apply orange to cell (0,0), blue to cell (0,1), and green to cell (0,2) using the pill popover for each individually, clicking outside to close the popover between each application.
    - expect: Cell (0,0) has orange backgroundColor.
    - expect: Cell (0,1) has blue backgroundColor.
    - expect: Cell (0,2) has green backgroundColor.
  3. Inspect the backgroundColor styles of the second row: cells (1,0), (1,1), (1,2).
    - expect: All cells in row 1 have empty backgroundColor styles — applying colors to row 0 did not affect row 1.
  4. Save the editor data and verify color data in the saved output.
    - expect: content[0][0].color is the orange color value.
    - expect: content[0][1].color is the blue color value (different from orange).
    - expect: content[0][2].color is the green color value (different from orange and blue).
    - expect: All cells in content[1] and content[2] have no 'color' property.

#### 5.3. Overwriting a cell color with a different color updates correctly

**File:** `test/playwright/tests/tools/table/table-cell-color-multi.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange color to cell (0,0). Click outside to close the popover.
    - expect: Cell (0,0) has orange backgroundColor.
  2. Select cell (0,0) again. Open the pill popover and color picker. Click the blue swatch. Click outside to close.
    - expect: Cell (0,0) backgroundColor is updated to blue (the previously orange color is replaced).
  3. Save the editor data.
    - expect: content[0][0].color is the blue color value, not the orange value.
    - expect: The orange color is not present in the saved data for cell (0,0).

#### 5.4. A multi-cell drag selection applies the same color to all selected cells

**File:** `test/playwright/tests/tools/table/table-cell-color-multi.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Pre-color cell (0,0) with orange and cell (2,2) with blue so different cells already have colors.
    - expect: Cell (0,0) has orange backgroundColor. Cell (2,2) has blue backgroundColor.
  2. Drag-select from cell (0,0) to cell (1,1) to create a 2x2 selection of 4 cells. Open the pill popover by hovering and clicking the pill. Then hover Color and click the green swatch.
    - expect: Cells (0,0), (0,1), (1,0), and (1,1) all have green backgroundColor (previously orange on (0,0) is overwritten).
    - expect: Cell (2,2) retains its blue backgroundColor (not affected by the new drag selection).
  3. Save the editor data and verify the content array.
    - expect: content[0][0].color is the green color value.
    - expect: content[0][1].color is the green color value.
    - expect: content[1][0].color is the green color value.
    - expect: content[1][1].color is the green color value.
    - expect: content[2][2].color is the blue color value.

### 6. Color Picker Tab Switching Behavior

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 6.1. Switching from Background to Text tab resets the swatch selection without clearing applied color

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0). Open the pill popover and hover Color to open the color picker. The Background tab should be active by default.
    - expect: Color picker is visible. Background tab (data-blok-testid='cell-color-tab-backgroundColor') is the active/default tab.
  2. Click the orange background swatch (data-blok-testid='cell-color-swatch-orange') with force:true.
    - expect: Cell (0,0) has a non-empty backgroundColor.
  3. Without closing the color picker, click the Text Color tab (data-blok-testid='cell-color-tab-textColor').
    - expect: The Text Color tab becomes active.
    - expect: Cell (0,0) backgroundColor is still non-empty (switching tabs did not remove the previously applied background color).
    - expect: The color swatches update to show text color options.
  4. Click the blue text color swatch (data-blok-testid='cell-color-swatch-blue') with force:true.
    - expect: Cell (0,0) color (text color) is non-empty.
    - expect: Cell (0,0) backgroundColor is still non-empty (both colors are applied simultaneously).

#### 6.2. Default button in Background tab only removes background color, not text color

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange background color and blue text color to cell (0,0) via the pill popover (open color picker, click orange on Background tab, switch to Text tab, click blue). Click outside to close the popover.
    - expect: Cell (0,0) has both backgroundColor (non-empty) and color (non-empty).
  2. Select cell (0,0) again. Open the pill popover and color picker. Ensure the Background Color tab is active. Click the Default button (data-blok-testid='cell-color-default-btn').
    - expect: Cell (0,0) backgroundColor becomes empty.
    - expect: Cell (0,0) color (text color) remains non-empty (the Default button only removed the background color, not the text color).

#### 6.3. Default button in Text tab only removes text color, not background color

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange background color and blue text color to cell (0,0). Click outside to close the popover.
    - expect: Cell (0,0) has both backgroundColor and color set.
  2. Select cell (0,0) again. Open the pill popover and color picker. Switch to the Text Color tab. Click the Default button.
    - expect: Cell (0,0) color (text color) becomes empty.
    - expect: Cell (0,0) backgroundColor remains non-empty (the Default button on the Text tab only cleared text color).

#### 6.4. Tab state resets to Background when color picker is closed and reopened

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table and select cell (0,0). Open the color picker and switch to the Text Color tab.
    - expect: Text Color tab is active.
  2. Click outside the table at (10, 10) to close all popovers.
    - expect: Color picker is closed.
  3. Select cell (0,0) again. Open the pill popover and hover Color to reopen the color picker.
    - expect: The color picker opens.
    - expect: The Background Color tab is the default active tab (not the previously selected Text tab — OR if the implementation preserves tab state, the Text tab is active; document whichever behavior is observed).

#### 6.5. All 10 color swatches are visible and functional on Background tab

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover and hover Color to open the color picker. Ensure the Background tab is active.
    - expect: Color picker is visible.
  2. Verify that all 10 expected swatches are visible: gray, brown, orange, yellow, green, teal, blue, purple, pink, red. Check each swatch locator: data-blok-testid='cell-color-swatch-{name}'.
    - expect: All 10 swatches are visible in the color picker on the Background tab.
  3. Click each swatch one by one (with force:true). After each click, verify cell (0,0) has a non-empty backgroundColor. Then re-open the color picker for the next swatch.
    - expect: Each of the 10 swatches applies a distinct non-empty backgroundColor to cell (0,0).
    - expect: The Default button (data-blok-testid='cell-color-default-btn') is also visible.

#### 6.6. All 10 color swatches are visible and functional on Text tab

**File:** `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover, hover Color, and switch to the Text Color tab.
    - expect: Text Color tab is active.
  2. Verify that all 10 swatches (gray, brown, orange, yellow, green, teal, blue, purple, pink, red) are visible in the color picker.
    - expect: All 10 swatches are present on the Text Color tab.
  3. Click at least 3 different text color swatches (e.g., orange, blue, red). After each click, verify that cell (0,0) has a non-empty color style.
    - expect: Each text color swatch applies a distinct non-empty color style to cell (0,0).

### 7. Cell Selection Clearing Behavior

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 7.1. Cell selection is cleared when clicking outside the table while the color picker is open

**File:** `test/playwright/tests/tools/table/table-cell-color-selection-clear.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover and hover Color to open the color picker. Verify the color picker is visible.
    - expect: Color picker is visible. Cell (0,0) has data-blok-table-cell-selected attribute.
  2. Click at coordinates (10, 10) which is outside the table boundaries.
    - expect: The color picker closes.
    - expect: The pill popover closes.
    - expect: No cells have the data-blok-table-cell-selected attribute (selection is cleared).
  3. Verify the selection overlay is removed from the DOM.
    - expect: No element with data-blok-table-selection-overlay attribute exists in the DOM.

#### 7.2. Clicking a different cell while a color picker is open replaces the selection with the new cell

**File:** `test/playwright/tests/tools/table/table-cell-color-selection-clear.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover and hover Color to open the color picker.
    - expect: Color picker is open for cell (0,0).
  2. Click on cell (2,2) using mouse coordinates.
    - expect: The color picker and pill popover close.
    - expect: Cell (0,0) loses the data-blok-table-cell-selected attribute.
    - expect: Cell (2,2) gains the data-blok-table-cell-selected attribute (new selection).

#### 7.3. Pressing Delete or Backspace with cells selected does not interfere with color-applied cells

**File:** `test/playwright/tests/tools/table/table-cell-color-selection-clear.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange background color to cell (0,0). Click outside to close the popover.
    - expect: Cell (0,0) has a non-empty backgroundColor.
  2. Drag-select cells (1,0) to (1,2) (the second row, all 3 cells) — a row that has NO color applied.
    - expect: 3 cells are selected (data-blok-table-cell-selected on 3 cells).
  3. Press the Delete key.
    - expect: The content of the 3 selected cells in row 1 is cleared.
    - expect: Cell (0,0) is not selected and still has a non-empty backgroundColor (the Delete key on a different row did not affect the colored cell).

#### 7.4. Selection pill disappears after clicking outside and reappears correctly for new cell selection

**File:** `test/playwright/tests/tools/table/table-cell-color-selection-clear.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Apply orange color to cell (0,0). Click outside to close the popover.
    - expect: Pill popover is closed. Cell (0,0) has orange backgroundColor.
  2. Verify no element with data-blok-table-selection-pill exists in the DOM (or it is not attached).
    - expect: The selection pill is not present.
  3. Click on cell (1,1) to create a new selection.
    - expect: A new selection pill with data-blok-table-selection-pill appears and is attached to the DOM.
  4. Hover the new pill, click to open the popover, hover Color, and apply blue color to cell (1,1).
    - expect: Cell (1,1) has a non-empty backgroundColor.
    - expect: Cell (0,0) still has its orange backgroundColor (independent).

### 8. Color Picker Closing Behavior

**Seed:** `test/playwright/tests/seed.spec.ts`

#### 8.1. Pressing Escape once closes the color picker but not the pill popover

**File:** `test/playwright/tests/tools/table/table-cell-color-close-behavior.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover. Hover the Color item to open the color picker.
    - expect: Both the pill popover and color picker nested popover are visible.
  2. Press Escape once.
    - expect: The color picker (data-blok-testid='cell-color-picker') is no longer visible.
    - expect: The parent pill popover items (Copy, Clear, Color) are still visible OR the entire popover tree closes (document the actual behavior as the expected outcome for future regression prevention).

#### 8.2. Clicking outside the color picker area but inside the pill popover keeps the pill popover open

**File:** `test/playwright/tests/tools/table/table-cell-color-close-behavior.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover and hover Color to open the color picker.
    - expect: Color picker is visible.
  2. Move the mouse to the 'Copy' item in the pill popover (away from the Color item) but do not click.
    - expect: The color picker closes because the mouse left the Color item.
    - expect: The pill popover (with Copy, Clear, Color) remains visible.

#### 8.3. Color picker does not reopen when moving mouse back from non-Color item after it has been dismissed

**File:** `test/playwright/tests/tools/table/table-cell-color-close-behavior.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover, hover Color to open the color picker, then move mouse to 'Copy' item to close the color picker.
    - expect: Color picker is closed. Pill popover is still open.
  2. Move the mouse back over the Color item.
    - expect: The color picker reopens when hovering the Color item again.

#### 8.4. Color picker closes and no color is applied when dismissed without selecting a swatch

**File:** `test/playwright/tests/tools/table/table-cell-color-close-behavior.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover and hover Color to open the color picker.
    - expect: Color picker is visible.
  2. Press Escape to close the popover tree. Inspect cell (0,0)'s backgroundColor and color styles.
    - expect: Cell (0,0) backgroundColor is empty (no color was applied).
    - expect: Cell (0,0) color is empty (no text color was applied).
  3. Save the editor data and inspect content[0][0].
    - expect: content[0][0] has no 'color' property or its 'color' is null/undefined.
    - expect: content[0][0] has no 'textColor' property or its 'textColor' is null/undefined.

#### 8.5. Pill popover closes when user starts a new drag selection over different cells

**File:** `test/playwright/tests/tools/table/table-cell-color-close-behavior.spec.ts`

**Steps:**
  1. Initialize the editor with a 3x3 table. Select cell (0,0). Open the pill popover.
    - expect: Pill popover is open with Copy, Clear, Color visible.
  2. Drag from cell (2,0) to cell (2,2) to create a new multi-cell selection.
    - expect: The original pill popover from cell (0,0) is closed.
    - expect: 3 cells in row 2 are selected (data-blok-table-cell-selected count is 3).
    - expect: A new selection pill appears for the new selection.
