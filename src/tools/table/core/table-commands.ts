/**
 * Typed table commands — the sole input vocabulary for table mutations.
 * Every mutation must be expressible as one of these commands.
 */
import type { TableData } from '../types';

export interface InsertRowCommand {
  readonly type: 'insert-row';
  /** Row index to insert at */
  readonly index: number;
}

export interface DeleteRowCommand {
  readonly type: 'delete-row';
  readonly index: number;
}

export interface MoveRowCommand {
  readonly type: 'move-row';
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface InsertColumnCommand {
  readonly type: 'insert-column';
  readonly index: number;
  readonly width?: number;
}

export interface DeleteColumnCommand {
  readonly type: 'delete-column';
  readonly index: number;
}

export interface MoveColumnCommand {
  readonly type: 'move-column';
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface ToggleHeadingCommand {
  readonly type: 'toggle-heading';
}

export interface ToggleHeadingColumnCommand {
  readonly type: 'toggle-heading-column';
}

export interface SetStretchedCommand {
  readonly type: 'set-stretched';
  readonly value: boolean;
}

export interface AddBlockToCellCommand {
  readonly type: 'add-block-to-cell';
  readonly row: number;
  readonly col: number;
  readonly blockId: string;
}

export interface RemoveBlockFromCellCommand {
  readonly type: 'remove-block-from-cell';
  readonly row: number;
  readonly col: number;
  readonly blockId: string;
}

export interface SetCellBlocksCommand {
  readonly type: 'set-cell-blocks';
  readonly row: number;
  readonly col: number;
  readonly blockIds: readonly string[];
}

export interface SetColWidthsCommand {
  readonly type: 'set-col-widths';
  readonly widths: readonly number[] | undefined;
}

export interface ReplaceAllCommand {
  readonly type: 'replace-all';
  readonly data: TableData;
}

export type TableCommand =
  | InsertRowCommand
  | DeleteRowCommand
  | MoveRowCommand
  | InsertColumnCommand
  | DeleteColumnCommand
  | MoveColumnCommand
  | ToggleHeadingCommand
  | ToggleHeadingColumnCommand
  | SetStretchedCommand
  | AddBlockToCellCommand
  | RemoveBlockFromCellCommand
  | SetCellBlocksCommand
  | SetColWidthsCommand
  | ReplaceAllCommand;
