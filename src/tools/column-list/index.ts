import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import { COLUMNS_ATTR } from '../columns-shared';
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

    return container;
  }

  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    mountChildBlocks(this.container, children);
  }

  public save(): ColumnListData {
    return {};
  }

  public validate(_data: ColumnListData): boolean {
    return true;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconColumns,
      titleKey: 'columns',
      name: 'column_list',
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnListData };
