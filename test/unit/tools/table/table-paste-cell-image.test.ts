import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Table } from '../../../../src/tools/table';
import { parseGenericHtmlTable } from '../../../../src/tools/table/table-cell-clipboard';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import type { TableConfig, TableData } from '../../../../src/tools/table/types';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const IMAGE_CELL = '<tr><td><img src="https://example.com/a.png" alt="cap"></td><td>text</td></tr>';

interface Inserted {
  tool: string | undefined;
  data: Record<string, unknown> | undefined;
}

const createMockAPI = (inserted: Inserted[]): API => ({
  styles: {},
  i18n: { t: (key: string) => key },
  blocks: {
    delete: () => {},
    insert: (tool?: string, data?: Record<string, unknown>) => {
      const holder = document.createElement('div');
      const id = `mock-${inserted.length}`;

      inserted.push({ tool, data });
      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    },
    getCurrentBlockIndex: () => 0,
    getBlocksCount: () => 0,
    getBlockIndex: () => undefined,
    setBlockParent: vi.fn(),
  },
  events: { on: vi.fn(), off: vi.fn() },
} as unknown as API);

const createTable = (inserted: Inserted[]): Table => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
    config: {},
    api: createMockAPI(inserted),
    readOnly: false,
    block: {} as never,
  };

  return new Table(options);
};

describe('a pasted table cell holding an image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('becomes an image block when pasted into an existing table', () => {
    const payload = parseGenericHtmlTable(`<table>${IMAGE_CELL}</table>`);

    expect(payload?.cells[0]?.[0]?.blocks).toEqual([
      { tool: 'image', data: { url: 'https://example.com/a.png', alt: 'cap' } },
    ]);
  });

  it('becomes an image block when pasted as a new table through the real paste sanitizer', () => {
    const builder = new SanitizerConfigBuilder({} as unknown as ToolsCollection<BlockToolAdapter>, {});
    const toolConfig = builder.buildToolConfig({ pasteConfig: Table.pasteConfig } as unknown as BlockToolAdapter);
    const raw = document.createElement('table');

    raw.innerHTML = IMAGE_CELL;

    const sanitized = builder.sanitizeTable(raw, toolConfig);

    if (sanitized === null) {
      throw new Error('sanitizer dropped the table');
    }

    const inserted: Inserted[] = [];
    const table = createTable(inserted);

    document.body.appendChild(table.render());
    table.rendered();
    inserted.length = 0;
    table.onPaste({ detail: { data: sanitized } } as unknown as CustomEvent);

    expect(inserted).toEqual([
      { tool: 'image', data: { url: 'https://example.com/a.png', alt: 'cap' } },
      { tool: 'paragraph', data: { text: 'text' } },
    ]);
  });
});
