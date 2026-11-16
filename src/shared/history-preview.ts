import type { LooseOutputBlockData, LooseOutputData } from '../../types';

export type ChangeMark = 'added' | 'changed' | 'removed' | 'moved';
export interface ChangePreview { blocks: LooseOutputBlockData[]; marks: Record<string, ChangeMark>; }
export type HistoryDiff = (before: LooseOutputData, after: LooseOutputData) => {
  added: Array<{id?: string}>; removed: Array<{id?: string}>; changed: Array<{id: string}>; moved: Array<{id: string}>;
};

const idOf = (block: LooseOutputBlockData): string | null =>
  typeof block.id === 'string' && block.id !== '' ? block.id : null;

const parentOf = (block: LooseOutputBlockData): string | null =>
  typeof block.parent === 'string' && block.parent !== '' ? block.parent : null;

/**
 * Siblings of a block in `document`, in order: the parent's `content` when it
 * lists them, else the order of the blocks array.
 */
const siblingsIn = (blocks: LooseOutputBlockData[], parent: string | null): string[] => {
  const listed = parent === null ? null : blocks.find((block) => idOf(block) === parent)?.content;
  const byArray = blocks
    .filter((block) => parentOf(block) === parent)
    .map(idOf)
    .filter((id): id is string => id !== null);

  if (listed == null) {
    return byArray;
  }

  return [...listed, ...byArray.filter((id) => !listed.includes(id))];
};

/**
 * The newer document with the changes made since `before` marked, and the
 * removed blocks put back where they used to be so they can be shown.
 * @param before - the older version
 * @param after - the version being previewed
 * @param diffOutputData - from `@bloklabs/core/view`
 */
export const changePreview = (
  before: LooseOutputData,
  after: LooseOutputData,
  diffOutputData: HistoryDiff
): ChangePreview => {
  const diff = diffOutputData(before, after);
  const marks: Record<string, ChangeMark> = {};
  const blocks: LooseOutputBlockData[] = after.blocks.map((block) => ({ ...block }));

  diff.added.forEach(({ id }) => {
    if (id !== undefined) {
      marks[id] = 'added';
    }
  });
  diff.changed.forEach(({ id }) => {
    marks[id] = 'changed';
  });
  // A block that moved and changed shows as changed.
  diff.moved.forEach(({ id }) => {
    marks[id] ??= 'moved';
  });

  diff.removed.forEach(({ id: removedId }) => {
    const original = before.blocks.find((block) => removedId !== undefined && idOf(block) === removedId);

    // The diff never matches a block without an id, so it cannot report one removed.
    if (original === undefined || removedId === undefined) {
      return;
    }

    marks[removedId] = 'removed';

    const parent = parentOf(original);

    // A child of a removed parent comes back inside that parent's own entry.
    if (parent !== null && marks[parent] === 'removed') {
      blocks.push({ ...original });

      return;
    }

    const oldSiblings = siblingsIn(before.blocks, parent);
    const newSiblings = siblingsIn(blocks, parent);
    const anchor = oldSiblings
      .slice(0, oldSiblings.indexOf(removedId))
      .reverse()
      .find((id) => newSiblings.includes(id));
    const anchorIndex = blocks.findIndex((block) => anchor !== undefined && idOf(block) === anchor);
    const firstSibling = blocks.findIndex((block) => idOf(block) === newSiblings[0]);
    const at = anchorIndex >= 0 ? anchorIndex + 1 : Math.max(firstSibling, 0);

    blocks.splice(at, 0, { ...original });

    const holder = parent === null ? undefined : blocks.find((block) => idOf(block) === parent);

    if (holder?.content != null) {
      const content = [...holder.content];

      content.splice(anchor === undefined ? 0 : content.indexOf(anchor) + 1, 0, removedId);
      holder.content = content;
    }
  });

  return { blocks, marks };
};

