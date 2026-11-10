import { announce } from './announcer';
import type { I18nInstance } from './tools';

interface TreeBlock {
  id: string;
  parentId: string | null;
}

/**
 * The selected blocks whose parent is not selected too. Notion counts only
 * these: a selected toggle with two children is one block (U135).
 * @param blocks - the selected blocks
 */
export const selectionRoots = <T extends TreeBlock>(blocks: T[]): T[] => {
  const ids = new Set(blocks.map((block) => block.id));

  return blocks.filter((block) => block.parentId === null || !ids.has(block.parentId));
};

/**
 * Says how many of `roots` a delete removed, like Notion: "2 blocks deleted".
 * Counting after the delete leaves out blocks it skipped (read-only ones).
 * @param i18n - translates message keys
 * @param roots - the selection roots taken before the delete
 * @param exists - whether a block is still in the document
 */
export const announceDeletedRoots = (i18n: I18nInstance, roots: TreeBlock[], exists: (id: string) => boolean): void => {
  const count = roots.filter((root) => !exists(root.id)).length;

  if (count > 0) {
    announce(i18n.t('a11y.blocksDeleted', { count }));
  }
};
