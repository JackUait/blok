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
  private evictionScheduled = false;

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
      // NEVER seed while the editor is replaying Yjs history (undo/redo) or
      // applying a remote change. During replay a re-added column_list fires
      // rendered() BEFORE its restored columns' own add events land, so
      // getChildren() is only TRANSIENTLY empty here — seeding now fabricates
      // phantom columns AND displaces the real ones (which then arrive orphaned
      // at root), the "2 columns silently became 4" corruption. Seeding is a
      // one-shot CREATION action; only a genuine, local user creation may seed.
      // The restored columns re-mount via their own setBlockParent during the
      // replay. (Column solves the analogous re-seed hazard with its `populated`
      // latch; a re-added list gets a fresh instance, so it needs this check.)
      if (this.api.blocks.isSyncingFromYjs) {
        return;
      }

      // Drag-beside inserts the list and then fills it with explicit columns,
      // so it opts out of the default auto-seed via the transient noSeed flag.
      if (this._data.noSeed !== true) {
        this.seedColumns();
      }

      return;
    }

    // STRUCTURAL INVARIANT (path-independent): a column_list renders EACH of its
    // children as a column, so a NON-`column` child would materialise as a
    // phantom extra column and shove the real columns sideways — the "2 columns
    // silently became 4 / content scrambled" corruption. `setBlockParent` is
    // called raw by ~30 sites (paste, drag, table, database, keyboard) and none
    // validate the child type, and a document may ALREADY be corrupted on disk by
    // the bug BEFORE this defense shipped. So render ONLY the genuine columns —
    // the phantom is unreachable no matter HOW a rogue child entered the model.
    const columnChildren = children.filter(child => child.name === COLUMN_TOOL);

    mountChildBlocks(this.container, columnChildren);
    buildColumnResizers(this.container, columnChildren.map(child => child.holder), this.readOnly, this.api, this.blockId);

    // A rogue child is never a legitimate transient (a column_list's only valid
    // children are columns; leaves parent to a `column`, never to the list), so
    // evict it from the MODEL too — otherwise it lingers invisibly in saved data
    // and the corruption survives every reload. Defer the eviction until the
    // current operation settles (`isSyncingFromYjs` back to 0): mutating mid
    // undo/redo replay is the RC2 hazard (it would write a stray parentId into
    // Yjs). The render filter above already blocks the phantom synchronously, so
    // deferring the model heal costs nothing visible.
    if (columnChildren.length !== children.length) {
      this.scheduleRogueEviction();
    }
  }

  /**
   * Evict every non-`column` direct child of this list once the editor is no
   * longer replaying Yjs history, re-validating at eviction time (the block may
   * have moved or been removed while we waited). Idempotent and self-terminating.
   */
  private scheduleRogueEviction(): void {
    if (this.evictionScheduled) {
      return;
    }

    this.evictionScheduled = true;

    const run = (): void => {
      // Still settling (load atomic wrapper or an in-flight undo/redo batch) —
      // try again next frame rather than write into Yjs mid-replay.
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(run);

        return;
      }

      this.evictionScheduled = false;

      // Re-read: the tree has settled, so anything that is STILL a non-column
      // child of this list is genuine corruption, not a transient.
      this.api.blocks
        .getChildren(this.blockId)
        .filter(child => child.name !== COLUMN_TOOL)
        .forEach(child => this.api.blocks.setBlockParent(child.id, null));
    };

    requestAnimationFrame(run);
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

  /**
   * A column_list's child blocks ARE its columns — it renders each one as a
   * column of the row. An outside block nested into it would become a column
   * that is not a `column`, so core must never let a user gesture adopt one.
   */
  public static get ownsChildren(): boolean {
    return true;
  }
}

export type { ColumnListData };
