import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table/index';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, BlockAPI } from '../../../../types';

/**
 * A collaboration session boots read-only until sync completes
 * (src/components/modules/readonly.ts:112, :141). The table nulled its pending
 * content before the read-only branch, and that branch paints the cell strings
 * into inert markup without creating any blocks (table-operations.ts:370-378).
 * When the veto lifted, setReadOnly(false) filled every cell with an empty
 * paragraph, so the cell text was gone.
 */

interface FakeBlock {
  id: string;
  name: string;
  holder: HTMLElement;
  parentId: string | null;
  data: Record<string, unknown>;
  preservedData: Record<string, unknown>;
}

const createFakeBlock = (id: string, name: string, data: Record<string, unknown>): FakeBlock => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  holder.textContent = typeof data.text === 'string' ? data.text : '';

  return { id, name, holder, parentId: null, data, preservedData: data };
};

/**
 * A block store the table can really mount from. The read-only mount and
 * initializeCells both resolve holders through getBlockIndex/getBlockByIndex,
 * and ensureCellHasBlock only inserts when transactWithoutCapture exists — a
 * mock missing any of them silently skips the code under test.
 */
const createMockAPI = (seed: FakeBlock[] = []): API => {
  const blocks: FakeBlock[] = [...seed];
  let counter = 0;

  const insert = vi.fn((
    name: string = 'paragraph',
    data: Record<string, unknown> = {}
  ): FakeBlock => {
    counter += 1;
    const block = createFakeBlock(`inserted-${counter}`, name, data);

    blocks.push(block);

    return block;
  });

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
    i18n: { t: (key: string) => key },
    blocks: {
      insert,
      getBlockIndex: vi.fn((id: string) => {
        const index = blocks.findIndex(block => block.id === id);

        return index === -1 ? undefined : index;
      }),
      getBlockByIndex: vi.fn((index: number) => blocks[index]),
      getBlocksCount: vi.fn(() => blocks.length),
      getCurrentBlockIndex: vi.fn(() => 0),
      getChildren: vi.fn((parentId: string) => blocks.filter(block => block.parentId === parentId)),
      setBlockParent: vi.fn((id: string, parentId: string) => {
        const block = blocks.find(candidate => candidate.id === id);

        if (block) {
          block.parentId = parentId;
        }
      }),
      transactWithoutCapture: vi.fn((fn: () => void) => fn()),
    },
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData>,
  readOnly: boolean,
  api: API = createMockAPI()
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, content: [], ...data } as TableData,
  config: {},
  api,
  readOnly,
  block: { id: 'table-block-1' } as BlockAPI,
});

const cellContainers = (wrapper: HTMLElement): HTMLElement[] =>
  Array.from(wrapper.querySelectorAll<HTMLElement>('[data-blok-table-cell-blocks]'));

describe('table cell text across the collaborative read-only boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps the cell text when the editor boots read-only and then becomes editable', () => {
    const options = createTableOptions({ content: [['Alpha', 'Beta']] }, true);
    const table = new Table(options);
    const insert = options.api.blocks.insert as ReturnType<typeof vi.fn>;

    document.body.appendChild(table.render());
    table.rendered();

    table.setReadOnly(false);

    const insertedTexts = insert.mock.calls.map(call => {
      const data = call[1] as { text?: string } | undefined;

      return data?.text ?? '';
    });

    expect(insertedTexts).toContain('Alpha');
  });

  // Control: the same table booted EDITABLE converts the cell strings into blocks.
  // This is what proves the assertion above measures the read-only boot and not a
  // gap in this harness.
  it('converts the cell text into blocks when it boots editable', () => {
    const options = createTableOptions({ content: [['Alpha', 'Beta']] }, false);
    const table = new Table(options);
    const insert = options.api.blocks.insert as ReturnType<typeof vi.fn>;

    document.body.appendChild(table.render());
    table.rendered();

    const insertedTexts = insert.mock.calls.map(call => {
      const data = call[1] as { text?: string } | undefined;

      return data?.text ?? '';
    });

    expect(insertedTexts).toContain('Alpha');
  });

  /**
   * The conversion must run ONCE. mountBlocksInCell duplicates any holder it
   * finds inside a [data-blok-nested-blocks] container it does not own, and the
   * cell blocks container carries that attribute — so converting on every
   * read-only→edit transition grew each cell by one block per toggle.
   */
  it('does not accumulate cell blocks across repeated read-only toggles', () => {
    const seeded = createFakeBlock('pre-1', 'paragraph', { text: 'Beta' });
    const api = createMockAPI([seeded]);
    const options = createTableOptions(
      { content: [['Alpha', { blocks: ['pre-1'] }]] },
      true,
      api
    );
    const table = new Table(options);
    const insert = api.blocks.insert as ReturnType<typeof vi.fn>;

    const wrapper = table.render();

    document.body.appendChild(wrapper);
    table.rendered();

    table.setReadOnly(false);

    const afterFirstTransition = cellContainers(wrapper);

    // The already-mounted block must be re-used, not duplicated.
    expect(afterFirstTransition[1].querySelector('[data-blok-id]')?.getAttribute('data-blok-id'))
      .toBe('pre-1');
    afterFirstTransition.forEach(container => {
      expect(container.querySelectorAll('[data-blok-id]')).toHaveLength(1);
      // A leftover child without a holder is the inert read-only text div,
      // which keeps rendering the stale text next to the real block.
      expect(container.querySelectorAll(':scope > :not([data-blok-id])')).toHaveLength(0);
    });

    const insertsAfterFirstTransition = insert.mock.calls.length;

    // Only the legacy string cell needed a new block.
    expect(insertsAfterFirstTransition).toBe(1);

    table.setReadOnly(true);
    table.setReadOnly(false);
    table.setReadOnly(true);
    table.setReadOnly(false);

    const containers = cellContainers(wrapper);

    expect(containers).toHaveLength(2);

    containers.forEach(container => {
      const holders = container.querySelectorAll('[data-blok-id]');

      expect(holders).toHaveLength(1);
      expect(container.querySelectorAll(':scope > :not([data-blok-id])')).toHaveLength(0);
    });

    expect(insert.mock.calls.length).toBe(insertsAfterFirstTransition);
  });

  /**
   * The live ordering: sync completes while the veto is still on, so the doc
   * arrives through setData() in read-only mode. That path refreshes the pending
   * content and returns without creating blocks, so the conversion at the
   * transition has to run over the SYNCED content, not the boot content.
   */
  it('converts the cell text when the sync lands while the editor is still read-only', () => {
    const api = createMockAPI();
    const options = createTableOptions({ content: [['Alpha', 'Beta']] }, true, api);
    const table = new Table(options);
    const insert = api.blocks.insert as ReturnType<typeof vi.fn>;

    document.body.appendChild(table.render());
    table.rendered();

    table.setData({ content: [['Alpha', 'Beta'], ['Gamma', 'Delta']] });

    table.setReadOnly(false);

    const insertedTexts = insert.mock.calls.map(call => (call[1] as { text?: string } | undefined)?.text ?? '');

    expect(insertedTexts).toContain('Gamma');
    expect(insertedTexts).toContain('Alpha');

    cellContainers(document.body).forEach(container => {
      expect(container.querySelectorAll('[data-blok-id]')).toHaveLength(1);
      expect(container.querySelectorAll(':scope > :not([data-blok-id])')).toHaveLength(0);
    });
  });

  // parentId is what the Renderer's normalizeTableChildParents backfills. A block
  // whose parentId is still null takes mountBlocksInCell's duplicate branch here
  // (its strandedInPreviousRender exception requires parentId === tableBlockId)
  // and comes back under a new id — a separate, pre-existing seam, not this fix.
  it('re-uses a block the sync delivered instead of duplicating it', () => {
    const seeded = createFakeBlock('pre-1', 'paragraph', { text: 'Beta' });

    seeded.parentId = 'table-block-1';
    const api = createMockAPI([seeded]);
    const options = createTableOptions({ content: [[{ blocks: ['pre-1'] }]] }, true, api);
    const table = new Table(options);
    const insert = api.blocks.insert as ReturnType<typeof vi.fn>;

    document.body.appendChild(table.render());
    table.rendered();

    table.setData({ content: [[{ blocks: ['pre-1'] }]] });

    table.setReadOnly(false);

    const containers = cellContainers(document.body);

    expect(containers[0].querySelector('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('pre-1');
    expect(insert).not.toHaveBeenCalled();
  });
});
