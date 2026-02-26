/**
 * Domain events emitted after successful table mutations.
 * Payloads contain ONLY serializable data (IDs, indices, counts).
 * No HTMLElement references — ever.
 */

export interface RowInsertedEvent {
  readonly type: 'row-inserted';
  readonly index: number;
  readonly cellsToPopulate: number;
}

export interface RowDeletedEvent {
  readonly type: 'row-deleted';
  readonly index: number;
  readonly blocksToDelete: readonly string[];
}

export interface RowMovedEvent {
  readonly type: 'row-moved';
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface ColumnInsertedEvent {
  readonly type: 'column-inserted';
  readonly index: number;
  readonly cellsToPopulate: ReadonlyArray<{ row: number; col: number }>;
}

export interface ColumnDeletedEvent {
  readonly type: 'column-deleted';
  readonly index: number;
  readonly blocksToDelete: readonly string[];
}

export interface ColumnMovedEvent {
  readonly type: 'column-moved';
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface HeadingToggledEvent {
  readonly type: 'heading-toggled';
  readonly withHeadings: boolean;
}

export interface HeadingColumnToggledEvent {
  readonly type: 'heading-column-toggled';
  readonly withHeadingColumn: boolean;
}

export interface StretchedChangedEvent {
  readonly type: 'stretched-changed';
  readonly stretched: boolean;
}

export interface BlockAddedToCellEvent {
  readonly type: 'block-added-to-cell';
  readonly row: number;
  readonly col: number;
  readonly blockId: string;
}

export interface BlockRemovedFromCellEvent {
  readonly type: 'block-removed-from-cell';
  readonly row: number;
  readonly col: number;
  readonly blockId: string;
}

export interface CellBlocksSetEvent {
  readonly type: 'cell-blocks-set';
  readonly row: number;
  readonly col: number;
  readonly blockIds: readonly string[];
}

export interface ColWidthsChangedEvent {
  readonly type: 'col-widths-changed';
  readonly widths: readonly number[] | undefined;
}

export interface ModelReplacedEvent {
  readonly type: 'model-replaced';
}

export type TableDomainEvent =
  | RowInsertedEvent
  | RowDeletedEvent
  | RowMovedEvent
  | ColumnInsertedEvent
  | ColumnDeletedEvent
  | ColumnMovedEvent
  | HeadingToggledEvent
  | HeadingColumnToggledEvent
  | StretchedChangedEvent
  | BlockAddedToCellEvent
  | BlockRemovedFromCellEvent
  | CellBlocksSetEvent
  | ColWidthsChangedEvent
  | ModelReplacedEvent;
