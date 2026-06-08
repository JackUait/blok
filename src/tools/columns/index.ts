import type { BaseToolConstructable } from '../../../types/tools';
import { Column } from '../column';
import { ColumnList } from '../column-list';

/**
 * Registration handle for the columns feature. Registering `Columns` under a
 * single tool key (e.g. `columns`) expands to the two real block tools that
 * back columns — `column_list` (the row container) and `column` (one slot).
 *
 * `Columns` is never instantiated as a block: no block has `type: 'columns'`.
 * Saved JSON still contains `column_list` and `column` blocks. See
 * docs/superpowers/specs/2026-06-08-single-key-columns-registration-design.md.
 */
export class Columns {
  public static get provides(): { [blockType: string]: BaseToolConstructable } {
    return {
      column_list: ColumnList as unknown as BaseToolConstructable,
      column: Column as unknown as BaseToolConstructable,
    };
  }
}
