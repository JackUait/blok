import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import { COLUMNS_ATTR, COLUMN_TOOL } from '../columns-shared';
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
  private container: HTMLElement | null = null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnListData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
  }

  public render(): HTMLElement {
    const container = document.createElement('div');

    container.className = twMerge('flex', 'flex-row', 'flex-wrap', 'gap-4', 'w-full');
    container.setAttribute(COLUMNS_ATTR, '');
    container.setAttribute('data-blok-testid', 'column-list');
    container.setAttribute(DATA_ATTR.nestedBlocks, '');

    this.container = container;

    ColumnList.ensureResponsiveStyles();

    return container;
  }

  /**
   * Injects a <style> tag (once per page) with responsive flex-item rules for
   * the direct block-holder children of a column_list.
   *
   * The Column tool applies `basis-full shrink-0` to its own rendered element
   * ([data-blok-column]), but the FLEX CHILDREN of the column_list container
   * are the block holder wrappers ([data-blok-element]), not [data-blok-column]
   * itself. This rule targets those holders so `flex-wrap` forces stacking on
   * narrow viewports.
   */
  private static ensureResponsiveStyles(): void {
    const id = 'blok-column-list-responsive';

    if (document.getElementById(id) !== null) {
      return;
    }

    const style = document.createElement('style');

    style.id = id;
    style.textContent = [
      '[data-blok-columns] > [data-blok-element]{flex-basis:100%;flex-shrink:0}',
      '@media (min-width:651px){',
      '[data-blok-columns] > [data-blok-element]{flex-basis:0;flex-shrink:1}',
      '}',
    ].join('');

    document.head.appendChild(style);
  }

  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      this.seedColumns();

      return;
    }

    mountChildBlocks(this.container, children);
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

    Array.from({ length: count }).forEach((_, i) => {
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
    });
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
