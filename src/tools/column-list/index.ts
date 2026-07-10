import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import {
  COLUMNS_ATTR,
  COLUMNS_STATIC_GUTTER_ATTR,
  COLUMN_RESIZER_ATTR,
  COLUMN_TOOL,
  buildColumnResizers,
} from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { twMerge } from '../../components/utils/tw';
import { buildIconColumnsCount } from '../../components/icons';
import type { ColumnListData } from './types';

/**
 * ColumnList block — horizontal container that hosts column children.
 * Created via slash-menu presets carrying a transient `columnCount` seed.
 */
export class ColumnList implements BlockTool {
  private readonly api: API;
  private _data: ColumnListData;
  private readonly blockId: string;
  private readOnly: boolean;
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

    // In read-only mode no resizers are built, so the container must supply the
    // horizontal gutter itself — otherwise columns render flush with no gap.
    if (this.readOnly) {
      container.setAttribute(COLUMNS_STATIC_GUTTER_ATTR, '');
    }

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
    buildColumnResizers(this.container, children.map(child => child.holder), this.readOnly, this.api, this.blockId);
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
      // Columns render asynchronously, so each column's rendered() hook seeds
      // and focuses its paragraph after this loop returns — the LAST one would
      // win the focus race. Tag every column except the first with noFocus so
      // only the first column claims the caret, deterministically.
      const column = this.api.blocks.insert(
        COLUMN_TOOL,
        { noFocus: i !== 0 },
        {},
        baseIndex + 1 + i,
        false,
        false
      );

      this.api.blocks.setBlockParent(column.id, this.blockId);
      container.appendChild(column.holder);

      return column;
    });

    buildColumnResizers(container, columns.map(column => column.holder), this.readOnly, this.api, this.blockId);
  }

  /**
   * Toggle read-only mode in place: the columns themselves are pure layout,
   * only the resize separators are interactive — drop them when entering
   * read-only, rebuild them when leaving.
   */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (this.container === null) {
      return;
    }

    if (state) {
      this.container
        .querySelectorAll(`[${COLUMN_RESIZER_ATTR}]`)
        .forEach(resizer => resizer.remove());

      // Resizers gone — the container now owns the gutter.
      this.container.setAttribute(COLUMNS_STATIC_GUTTER_ATTR, '');

      return;
    }

    // Resizers reinstate the gutter, so drop the container's static one to
    // avoid doubling the gap.
    this.container.removeAttribute(COLUMNS_STATIC_GUTTER_ATTR);

    const children = this.api.blocks.getChildren(this.blockId);

    buildColumnResizers(this.container, children.map(child => child.holder), false, this.api, this.blockId);
  }

  public save(): ColumnListData {
    return {};
  }

  public validate(_data: ColumnListData): boolean {
    return true;
  }

  public static get toolbox(): ToolboxConfig {
    const base = {
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
      searchTermKeys: ['columns', 'layout'],
    };

    return [2, 3, 4, 5].map(count => ({
      ...base,
      icon: buildIconColumnsCount(count),
      titleKey: `tools.columns.col${count}`,
      name: `column_list-${count}`,
      data: { columnCount: count },
      searchTerms: [...base.searchTerms, `${count}c`, `c${count}`],
    }));
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnListData };
