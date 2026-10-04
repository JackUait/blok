import { isInsideTableCell } from '../../tools/table/table-restrictions';

interface TreeBlock {
  name: string;
  parentId: string | null;
  holder: HTMLElement;
}

/**
 * The nearest table above `block` when `block` sits in one of its cells.
 * @param block - the block to start from
 * @param getBlockById - looks up a parent by id
 */
export const enclosingCellTable = <T extends TreeBlock>(
  block: T,
  getBlockById: (id: string) => T | undefined
): T | undefined => {
  if (block.parentId == null || !isInsideTableCell(block.holder)) {
    return undefined;
  }

  const walk = (parentId: string | null): T | undefined => {
    const parent = parentId !== null ? getBlockById(parentId) : undefined;

    return parent === undefined || parent.name === 'table' ? parent : walk(parent.parentId);
  };

  return walk(block.parentId);
};
