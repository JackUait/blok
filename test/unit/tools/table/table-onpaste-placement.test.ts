/**
 * Loss #5: pasted cell alignment was dropped.
 *
 * Table.pasteConfig whitelists `style` on TD/TH, so inline `text-align` /
 * `vertical-align` SURVIVE the paste sanitizer — but nothing read them, even
 * though Blok stores exactly that as the per-cell 9-way `placement`.
 *
 * Per the Paste attribute law, the first test drives the REAL sanitizer
 * (SanitizerConfigBuilder + Table.pasteConfig) so a regression in the
 * whitelist fails here too, not only in the reader.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { CellContent, TableData, TableConfig } from '../../../../src/tools/table/types';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
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
      insert: (_tool?: string, data?: { text?: string }) => {
        const holder = document.createElement('div');
        const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

        holder.setAttribute('data-blok-id', id);
        holder.textContent = data?.text ?? '';

        return { id, holder };
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
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data },
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

const createPasteTable = (rowsHtml: string): HTMLTableElement => {
  const tableEl = document.createElement('table');

  tableEl.innerHTML = rowsHtml;

  return tableEl;
};

/** Run the pasted table through the REAL paste sanitizer with Table.pasteConfig. */
const sanitizeWithTablePasteConfig = (tableEl: HTMLTableElement): Element => {
  const builder = new SanitizerConfigBuilder(
    {} as unknown as ToolsCollection<BlockToolAdapter>,
    {}
  );
  const toolConfig = builder.buildToolConfig({
    pasteConfig: Table.pasteConfig,
  } as unknown as BlockToolAdapter);

  const sanitized = builder.sanitizeTable(tableEl, toolConfig);

  if (sanitized === null) {
    throw new Error('sanitizer dropped the pasted table');
  }

  return sanitized;
};

const pasteAndSave = (rowsHtml: string, throughSanitizer: boolean): TableData => {
  const table = new Table(createTableOptions({ content: [['A']] }));
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const pasted = createPasteTable(rowsHtml);
  const data = throughSanitizer ? sanitizeWithTablePasteConfig(pasted) : pasted;

  table.onPaste({ detail: { data } } as unknown as CustomEvent);

  const wrapper = document.querySelector<HTMLElement>('[data-blok-tool="table"]');

  if (!wrapper) {
    throw new Error('table wrapper not found after paste');
  }

  return table.save(wrapper);
};

const cellAt = (saved: TableData, row: number, col: number): CellContent => {
  const cell = saved.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell content at [${row}][${col}]`);
  }

  return cell;
};

describe('Table onPaste — external cell alignment becomes cell placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('maps text-align/vertical-align through the REAL paste sanitizer onto placement', () => {
    const saved = pasteAndSave(
      '<tr>'
      + '<td style="text-align: center; vertical-align: middle">A</td>'
      + '<td style="text-align: right; vertical-align: bottom">B</td>'
      + '</tr>',
      true,
    );

    expect(cellAt(saved, 0, 0).placement).toBe('middle-center');
    expect(cellAt(saved, 0, 1).placement).toBe('bottom-right');
  });

  it('defaults the missing axis (text-align only → top-*)', () => {
    const saved = pasteAndSave('<tr><td style="text-align: center">A</td></tr>', false);

    expect(cellAt(saved, 0, 0).placement).toBe('top-center');
  });

  it('defaults the missing axis (vertical-align only → *-left)', () => {
    const saved = pasteAndSave('<tr><td style="vertical-align: bottom">A</td></tr>', false);

    expect(cellAt(saved, 0, 0).placement).toBe('bottom-left');
  });

  it('leaves placement unset for default (top-left) alignment', () => {
    const saved = pasteAndSave(
      '<tr><td style="text-align: left; vertical-align: top">A</td><td>B</td></tr>',
      false,
    );

    expect(cellAt(saved, 0, 0).placement).toBeUndefined();
    expect(cellAt(saved, 0, 1).placement).toBeUndefined();
  });

  it('ignores alignment keywords Blok has no placement for (justify)', () => {
    const saved = pasteAndSave('<tr><td style="text-align: justify">A</td></tr>', false);

    expect(cellAt(saved, 0, 0).placement).toBeUndefined();
  });
});
