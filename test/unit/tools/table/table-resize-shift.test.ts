import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('Table resize shift regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('percent-mode table has scroll container with padding before first resize', () => {
    const options = createTableOptions({
      content: [['A', 'B'], ['C', 'D']],
    });
    const table = new Table(options);
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // A scroll container must exist from the start so that the table does not
    // shift 9px down and right when the user first resizes a column.
    const scrollContainer = element.querySelector('[data-blok-table-scroll]');

    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.classList.contains('pt-[9px]')).toBe(true);
    expect(scrollContainer?.classList.contains('pl-[9px]')).toBe(true);

    document.body.removeChild(element);
  });

  it('table position does not change after first column resize drag', () => {
    const options = createTableOptions({
      content: [['A', 'B'], ['C', 'D']],
    });
    const table = new Table(options);
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    // Record grid position before resize
    const gridBefore = element.querySelector('[data-blok-table-row]')?.parentElement;
    const parentBefore = gridBefore?.parentElement;
    const paddingTopBefore = parentBefore ? getComputedStyle(parentBefore).paddingTop : '';
    const paddingLeftBefore = parentBefore ? getComputedStyle(parentBefore).paddingLeft : '';

    // Simulate a resize drag on the first column border
    const handle = element.querySelector('[data-blok-table-resize]') as HTMLElement;

    expect(handle).not.toBeNull();

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }));
    document.dispatchEvent(new PointerEvent('pointerup', {}));

    // After resize, the grid's parent padding must not have changed
    const gridAfter = element.querySelector('[data-blok-table-row]')?.parentElement;
    const parentAfter = gridAfter?.parentElement;
    const paddingTopAfter = parentAfter ? getComputedStyle(parentAfter).paddingTop : '';
    const paddingLeftAfter = parentAfter ? getComputedStyle(parentAfter).paddingLeft : '';

    expect(paddingTopAfter).toBe(paddingTopBefore);
    expect(paddingLeftAfter).toBe(paddingLeftBefore);

    // The grid's parent should be the same element (not reparented mid-interaction)
    expect(parentAfter).toBe(parentBefore);

    document.body.removeChild(element);
  });
});
