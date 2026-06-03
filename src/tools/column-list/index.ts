import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import {
  COLUMNS_ATTR,
  COLUMN_TOOL,
  COLUMN_RESIZER_ATTR,
  COLUMN_MIN_WIDTH,
  resizeColumnGrow,
} from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconColumns } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import type { ColumnListData } from './types';

/**
 * ColumnList block — horizontal container that hosts column children.
 * Created via slash-menu presets carrying a transient `columnCount` seed.
 */
export class ColumnList implements BlockTool {
  private readonly api: API;
  private _data: ColumnListData;
  private readonly blockId: string;
  private readonly readOnly: boolean;
  private container: HTMLElement | null = null;

  constructor({ data, api, block, readOnly }: BlockToolConstructorOptions<ColumnListData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.readOnly = readOnly;
  }

  public render(): HTMLElement {
    const container = document.createElement('div');

    // Horizontal gutter comes from the resizer elements, not flex gap, so a
    // separator can live in the space between columns. Keep a vertical gap for
    // the responsive stacked layout.
    container.className = twMerge('flex', 'flex-row', 'flex-wrap', 'gap-y-4', 'w-full');
    container.setAttribute(COLUMNS_ATTR, '');
    container.setAttribute('data-blok-testid', 'column-list');
    container.setAttribute(DATA_ATTR.nestedBlocks, '');

    this.container = container;

    return container;
  }

  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      // Drag-beside inserts the list and then fills it with explicit columns,
      // so it opts out of the default auto-seed via the transient noSeed flag.
      if (this._data.noSeed !== true) {
        this.seedColumns();
      }

      return;
    }

    mountChildBlocks(this.container, children);
    this.buildResizers(children.map(child => child.holder));
  }

  private seedColumns(): void {
    const container = this.container;

    if (container === null) {
      return;
    }

    const count = this._data.columnCount ?? 2;
    const baseIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (baseIndex === undefined) {
      return;
    }

    // Clear the transient seed so a later re-render never re-seeds.
    this._data = { ...this._data, columnCount: undefined };

    const columns = Array.from({ length: count }).map((_, i) => {
      const column = this.api.blocks.insert(
        COLUMN_TOOL,
        {},
        {},
        baseIndex + 1 + i,
        false,
        false
      );

      this.api.blocks.setBlockParent(column.id, this.blockId);
      container.appendChild(column.holder);

      return column;
    });

    // Each column's rendered() hook seeds a paragraph and focuses it, so the
    // last column wins by default. Override: place the caret in the FIRST
    // column's first paragraph.
    const [firstColumn] = columns;
    const firstChild = this.api.blocks.getChildren(firstColumn.id)[0];

    if (firstChild !== undefined) {
      this.api.caret.setToBlock(firstChild.id, 'start');
    }

    this.buildResizers(columns.map(column => column.holder));
  }

  /**
   * Place a drag-to-resize separator between each adjacent pair of column
   * holders. Rebuilt from scratch so repeated renders never stack duplicates.
   * Skipped in read-only mode — columns are not resizable there.
   */
  private buildResizers(holders: HTMLElement[]): void {
    const container = this.container;

    if (container === null || this.readOnly) {
      return;
    }

    container
      .querySelectorAll(`[${COLUMN_RESIZER_ATTR}]`)
      .forEach(resizer => resizer.remove());

    holders.slice(1).forEach((rightHolder, index) => {
      const leftHolder = holders[index];
      const resizer = this.createResizer(leftHolder, rightHolder);

      container.insertBefore(resizer, rightHolder);
    });
  }

  private createResizer(leftHolder: HTMLElement, rightHolder: HTMLElement): HTMLElement {
    const resizer = document.createElement('div');

    resizer.setAttribute(COLUMN_RESIZER_ATTR, '');
    resizer.setAttribute('data-blok-testid', 'column-resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');

    resizer.addEventListener('pointerdown', event => {
      this.startResize(event, resizer, leftHolder, rightHolder);
    });

    return resizer;
  }

  /**
   * Drag handler: redistribute flex-grow between the two neighbouring columns
   * as the separator moves. Pointer capture keeps the move/up events flowing to
   * the resizer even when the cursor leaves it. The holder's flex-grow is the
   * persisted source of truth, so no api.blocks.update is needed.
   */
  private startResize(
    event: PointerEvent,
    resizer: HTMLElement,
    leftHolder: HTMLElement,
    rightHolder: HTMLElement
  ): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    // Alias the holders to locals so the move handler mutates their flex-grow
    // without tripping no-param-reassign on the parameters.
    const leftEl = leftHolder;
    const rightEl = rightHolder;
    const startX = event.clientX;
    const leftWidth = leftEl.getBoundingClientRect().width;
    const rightWidth = rightEl.getBoundingClientRect().width;
    const leftGrow = Number(leftEl.style.flexGrow) || 1;
    const rightGrow = Number(rightEl.style.flexGrow) || 1;

    resizer.setPointerCapture(event.pointerId);
    resizer.setAttribute('data-dragging', '');

    const onMove = (moveEvent: PointerEvent): void => {
      const next = resizeColumnGrow({
        leftWidth,
        rightWidth,
        leftGrow,
        rightGrow,
        delta: moveEvent.clientX - startX,
        minWidth: COLUMN_MIN_WIDTH,
      });

      leftEl.style.flexGrow = String(next.leftGrow);
      rightEl.style.flexGrow = String(next.rightGrow);
    };

    const onUp = (upEvent: PointerEvent): void => {
      resizer.releasePointerCapture(upEvent.pointerId);
      resizer.removeAttribute('data-dragging');
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onUp);
    };

    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onUp);
  }

  public save(): ColumnListData {
    return {};
  }

  public validate(_data: ColumnListData): boolean {
    return true;
  }

  public static get toolbox(): ToolboxConfig {
    const base = {
      icon: IconColumns,
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
      searchTermKeys: ['columns', 'layout'],
    };

    return [
      {
        ...base,
        titleKey: 'columns',
        name: 'column_list',
      },
      ...[2, 3, 4, 5].map(count => ({
        ...base,
        titleKey: `tools.columns.col${count}`,
        name: `column_list-${count}`,
        data: { columnCount: count },
        searchTerms: [...base.searchTerms, `${count}c`, `c${count}`],
      })),
    ];
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnListData };
