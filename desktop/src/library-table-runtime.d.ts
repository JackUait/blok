/** A transient projection of an existing authorized page/block, never persisted. */
export interface LibraryTableRow {
  id: string;
  title: string;
  icon?: string;
  updatedAt?: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}
export function createLibraryTable(container: HTMLElement, options: {
  onOpen(id: string): void;
  onToggle(id: string): void;
}): {
  update(rows: LibraryTableRow[]): void;
  destroy(): void;
};
