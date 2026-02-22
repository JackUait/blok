import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => {
  return {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      delete: () => {},
      insert: () => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

        return { id: `mock-${Math.random().toString(36).slice(2, 8)}`, holder };
      },
      getCurrentBlockIndex: () => 0,
      getBlocksCount: () => 0,
      getBlockIndex: () => undefined,
      setBlockParent: vi.fn(),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

/**
 * Create an HTML table element for pasting.
 */
const createPasteTable = (html: string): HTMLTableElement => {
  const tableEl = document.createElement('table');

  tableEl.innerHTML = html;

  return tableEl;
};

/**
 * Fire an onPaste event with the given HTML element.
 */
const firePasteEvent = (table: Table, element: HTMLElement): void => {
  const event = {
    detail: { data: element },
  } as unknown as CustomEvent;

  table.onPaste(event);
};

describe('Table onPaste metadata reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets withHeadingColumn to false after pasting a table', () => {
    const options = createTableOptions({
      withHeadingColumn: true,
      content: [['A', 'B'], ['C', 'D']],
    });
    const table = new Table(options);

    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // Paste a 2x3 table (no heading column concept in HTML)
    const pasteHtml = '<tr><td>X</td><td>Y</td><td>Z</td></tr><tr><td>1</td><td>2</td><td>3</td></tr>';

    firePasteEvent(table, createPasteTable(pasteHtml));

    const pastedElement = table.render();

    table.rendered();

    const saved = table.save(pastedElement);

    expect(saved.withHeadingColumn).toBe(false);

    element.parentNode?.removeChild(element);
    pastedElement.parentNode?.removeChild(pastedElement);
  });

  it('resets colWidths after pasting a table with different column count', () => {
    // Old table has 3 columns with specific widths
    const options = createTableOptions({
      content: [['A', 'B', 'C'], ['D', 'E', 'F']],
      colWidths: [100, 200, 300],
    });
    const table = new Table(options);

    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // Paste a table with 5 columns — old colWidths [100,200,300] would be wrong
    const pasteHtml = '<tr><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr>';

    firePasteEvent(table, createPasteTable(pasteHtml));

    const pastedElement = table.render();

    table.rendered();

    const saved = table.save(pastedElement);

    // colWidths should be undefined (reset) since old widths don't match new column count
    expect(saved.colWidths).toBeUndefined();

    element.parentNode?.removeChild(element);
    pastedElement.parentNode?.removeChild(pastedElement);
  });

  it('resets colWidths after pasting a table with same column count', () => {
    // Even with same column count, pasted table should not inherit old widths
    const options = createTableOptions({
      content: [['A', 'B'], ['C', 'D']],
      colWidths: [150, 250],
    });
    const table = new Table(options);

    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // Paste a table with 2 columns — same count, but widths should still reset
    const pasteHtml = '<tr><td>X</td><td>Y</td></tr><tr><td>1</td><td>2</td></tr>';

    firePasteEvent(table, createPasteTable(pasteHtml));

    const pastedElement = table.render();

    table.rendered();

    const saved = table.save(pastedElement);

    expect(saved.colWidths).toBeUndefined();

    element.parentNode?.removeChild(element);
    pastedElement.parentNode?.removeChild(pastedElement);
  });

  it('does not carry stale metadata when pasting over a fully configured table', () => {
    // Create a table with ALL metadata set
    const options = createTableOptions({
      withHeadings: true,
      withHeadingColumn: true,
      content: [['H1', 'H2', 'H3'], ['A', 'B', 'C']],
      colWidths: [100, 200, 300],
    });
    const table = new Table(options);

    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // Paste a plain table with no headings and different dimensions
    const pasteHtml = '<tr><td>X</td><td>Y</td></tr>';

    firePasteEvent(table, createPasteTable(pasteHtml));

    const pastedElement = table.render();

    table.rendered();

    const saved = table.save(pastedElement);

    // withHeadings should be false (no thead or th in pasted table)
    expect(saved.withHeadings).toBe(false);
    // withHeadingColumn must be reset
    expect(saved.withHeadingColumn).toBe(false);
    // colWidths must be reset
    expect(saved.colWidths).toBeUndefined();

    element.parentNode?.removeChild(element);
    pastedElement.parentNode?.removeChild(pastedElement);
  });
});
