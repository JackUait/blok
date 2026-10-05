import type { OutputBlockData, OutputData } from '../../types';
import { isPagePointer } from '../shared/page-pointer';

export interface PageBlockPlacement {
  parentId: string | null;
  afterId: string | null;
}

export interface PageBlockMove {
  source: OutputData;
  target: OutputData;
  movedIds: string[];
}

const indexBlocks = (blocks: OutputBlockData[]): Map<string, OutputBlockData> => {
  const byId = new Map<string, OutputBlockData>();

  for (const block of blocks) {
    if (!block.id || byId.has(block.id)) {
      throw new Error('Missing or duplicate block ID');
    }
    byId.set(block.id, block);
  }

  return byId;
};

const validateHierarchy = (byId: Map<string, OutputBlockData>, label: 'source' | 'target'): void => {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new Error(`${label} hierarchy cycle`);
    }
    if (visited.has(id)) {
      return;
    }

    const block = byId.get(id);
    const children = block?.content ?? [];

    if (block && isPagePointer(block.type, block.data) && children.length > 0) {
      throw new Error('A page pointer cannot own body blocks');
    }
    if (new Set(children).size !== children.length) {
      throw new Error(`Duplicate ${label} content ID`);
    }

    visiting.add(id);
    for (const childId of children) {
      const child = byId.get(childId);

      if (!child) {
        throw new Error(`Missing ${label} child block`);
      }
      if (child.parent !== id) {
        throw new Error(`Broken ${label} child link`);
      }
      visit(childId);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const [id, block] of byId) {
    if (block.parent && !byId.get(block.parent)?.content?.includes(id)) {
      throw new Error(`Broken ${label} parent link`);
    }
  }
  for (const id of byId.keys()) {
    visit(id);
  }
};

export function movePageBlocks(
  source: OutputData,
  target: OutputData,
  roots: readonly string[],
  place: PageBlockPlacement
): PageBlockMove {
  if (roots.length === 0 || new Set(roots).size !== roots.length) {
    throw new Error('Invalid roots');
  }

  const sourceById = indexBlocks(source.blocks);
  const targetById = indexBlocks(target.blocks);

  validateHierarchy(sourceById, 'source');
  validateHierarchy(targetById, 'target');

  const selected = new Set<string>();
  const movedIds: string[] = [];

  const visit = (id: string): void => {
    const block = sourceById.get(id);

    if (!block) {
      throw new Error('Missing child block');
    }
    if (selected.has(id)) {
      throw new Error('Nested root selected twice');
    }

    selected.add(id);
    movedIds.push(id);

    for (const childId of block.content ?? []) {
      visit(childId);
    }
  };

  for (const root of roots) {
    visit(root);
  }

  for (const id of movedIds) {
    if (targetById.has(id)) {
      throw new Error('Target ID collision');
    }
  }

  const parent = place.parentId === null ? null : targetById.get(place.parentId);

  if (place.parentId !== null && !parent) {
    throw new Error('Target parent missing');
  }
  if (parent && isPagePointer(parent.type, parent.data)) {
    throw new Error('Page pointer cannot contain blocks');
  }
  if (parent?.type === 'page-link') {
    throw new Error('Page link cannot contain blocks');
  }
  if (parent?.type === 'table') {
    throw new Error('Table owns its children');
  }
  if (parent?.type === 'database' && roots.some((id) => sourceById.get(id)?.type !== 'database-row')) {
    throw new Error('Database only accepts row children');
  }
  if (parent?.type === 'column_list' && roots.some((id) => sourceById.get(id)?.type !== 'column')) {
    throw new Error('Column list only accepts column children');
  }

  const sibling = place.afterId === null ? null : targetById.get(place.afterId);

  if (place.afterId !== null && (!sibling || (sibling.parent ?? null) !== place.parentId)) {
    throw new Error('Target sibling is not a direct child');
  }
  if (parent && sibling && !parent.content?.includes(sibling.id ?? '')) {
    throw new Error('Target sibling missing from content order');
  }

  const isInsideTableOrDatabase = (id: string): boolean => {
    const parentId = sourceById.get(id)?.parent;

    if (!parentId) {
      return false;
    }

    const parentType = sourceById.get(parentId)?.type;

    return parentType === 'table' || parentType === 'database' || isInsideTableOrDatabase(parentId);
  };

  for (const rootId of roots) {
    const parentId = sourceById.get(rootId)?.parent;
    const parent = parentId ? sourceById.get(parentId) : undefined;

    if (parent?.type === 'column_list' || isInsideTableOrDatabase(rootId)) {
      throw new Error('Move the whole table, database or column');
    }
  }

  const nextSource = structuredClone(source);

  nextSource.blocks = nextSource.blocks
    .filter((block) => !selected.has(block.id ?? ''))
    .map((block) => block.content
      ? { ...block, content: block.content.filter((id) => !selected.has(id)) }
      : block);

  const nextTarget = structuredClone(target);
  const rootSet = new Set(roots);
  const moved = movedIds.map((id) => {
    const block = sourceById.get(id);

    if (!block) {
      throw new Error('Missing moved block');
    }
    const copy = structuredClone(block);

    if (rootSet.has(id)) {
      if (place.parentId === null) {
        delete copy.parent;
      } else {
        copy.parent = place.parentId;
      }
    }

    return copy;
  });

  const descendantEnd = (id: string): number => {
    const block = targetById.get(id);

    if (!block) {
      throw new Error('Target block missing');
    }

    return Math.max(
      target.blocks.findIndex((item) => item.id === id),
      ...(block.content ?? []).map(descendantEnd)
    );
  };

  const siblings = parent
    ? parent.content ?? []
    : target.blocks
      .filter((block) => !block.parent)
      .map((block) => block.id)
      .filter((id): id is string => typeof id === 'string');
  const nextSiblingId = sibling
    ? siblings[siblings.indexOf(sibling.id ?? '') + 1]
    : siblings[0];
  const insertionIndex = (): number => {
    if (nextSiblingId) {
      return target.blocks.findIndex((block) => block.id === nextSiblingId);
    }
    if (sibling) {
      return descendantEnd(sibling.id ?? '') + 1;
    }
    if (parent) {
      return target.blocks.findIndex((block) => block.id === parent.id) + 1;
    }

    return 0;
  };

  nextTarget.blocks.splice(insertionIndex(), 0, ...moved);

  if (parent) {
    const nextParent = nextTarget.blocks.find((block) => block.id === parent.id);

    if (!nextParent) {
      throw new Error('Target parent missing');
    }
    const content = [...(nextParent.content ?? [])];

    content.splice(sibling ? content.indexOf(sibling.id ?? '') + 1 : 0, 0, ...roots);
    nextParent.content = content;
  }

  return { source: nextSource, target: nextTarget, movedIds };
}

export function turnBlocksIntoPage(
  source: OutputData,
  roots: readonly string[],
  ids: { pageId: string; pointerId: string }
): { source: OutputData; pageBody: OutputData; pointerId: string } {
  if (!ids.pageId || !ids.pointerId) {
    throw new Error('Invalid pageId or pointerId');
  }

  const byId = indexBlocks(source.blocks);

  if (byId.has(ids.pointerId)) {
    throw new Error('Page pointer ID collision');
  }
  if (roots.length === 0 || new Set(roots).size !== roots.length) {
    throw new Error('Invalid roots');
  }

  const first = byId.get(roots[0] ?? '');

  if (!first) {
    throw new Error('Selected block missing');
  }

  const parentId = first.parent ?? null;

  if (roots.some((id) => !byId.has(id))) {
    throw new Error('Selected block missing');
  }
  if (roots.some((id) => (byId.get(id)?.parent ?? null) !== parentId)) {
    throw new Error('Selected blocks must share a parent');
  }

  const siblings = parentId === null
    ? source.blocks.filter((block) => !block.parent).map((block) => block.id)
    : byId.get(parentId)?.content;
  const firstSibling = siblings?.indexOf(roots[0]);

  if (firstSibling === undefined || firstSibling < 0 ||
      roots.some((id, index) => siblings?.[firstSibling + index] !== id)) {
    throw new Error('Selected blocks must be adjacent and ordered');
  }

  const firstBlockIndex = source.blocks.findIndex((block) => block.id === roots[0]);
  const moved = movePageBlocks(source, { blocks: [] }, roots, {
    parentId: null,
    afterId: null,
  });
  const movedSet = new Set(moved.movedIds);
  const insertAt = source.blocks.slice(0, firstBlockIndex)
    .filter((block) => !movedSet.has(block.id ?? '')).length;
  const pointer: OutputBlockData = {
    id: ids.pointerId,
    type: 'page',
    data: { pageId: ids.pageId },
  };

  if (parentId !== null) {
    pointer.parent = parentId;
    const parent = moved.source.blocks.find((block) => block.id === parentId);

    if (!parent) {
      throw new Error('Selected parent missing');
    }
    const content = [...(parent.content ?? [])];

    content.splice(firstSibling, 0, ids.pointerId);
    parent.content = content;
  }

  moved.source.blocks.splice(insertAt, 0, pointer);

  return { source: moved.source, pageBody: moved.target, pointerId: ids.pointerId };
}

export function turnPageIntoBlocks(
  source: OutputData,
  pointerId: string,
  loaded: { pageId: string; body: OutputData } | null
): { source: OutputData; retiredPageId: string; movedIds: string[] } {
  const pointer = source.blocks.find((block) => block.id === pointerId);
  const pageId = pointer?.data.pageId;

  if (pointer?.type !== 'page' || typeof pageId !== 'string' || !pageId) {
    throw new Error('Page pointer missing');
  }
  if (loaded === null) {
    throw new Error('Page body failed to load');
  }
  if (loaded.pageId !== pageId) {
    throw new Error('PageId mismatch');
  }

  const parentId = pointer.parent ?? null;
  const siblings = parentId === null
    ? source.blocks.filter((block) => !block.parent).map((block) => block.id)
    : source.blocks.find((block) => block.id === parentId)?.content;
  const pointerIndex = siblings?.indexOf(pointerId);

  if (pointerIndex === undefined || pointerIndex < 0) {
    throw new Error('Page pointer missing from parent');
  }
  const afterId = siblings?.[pointerIndex - 1] ?? null;
  const withoutPointer = movePageBlocks(source, { blocks: [] }, [pointerId], {
    parentId: null,
    afterId: null,
  }).source;

  if (loaded.body.blocks.length === 0) {
    return { source: withoutPointer, retiredPageId: pageId, movedIds: [] };
  }

  const roots = loaded.body.blocks
    .filter((block) => !block.parent)
    .map((block) => block.id)
    .filter((id): id is string => typeof id === 'string');

  if (roots.length === 0) {
    throw new Error('Page body has no root blocks');
  }

  const moved = movePageBlocks(loaded.body, withoutPointer, roots, { parentId, afterId });

  if (moved.movedIds.length !== loaded.body.blocks.length) {
    throw new Error('Page body contains unreachable blocks');
  }

  return { source: moved.target, retiredPageId: pageId, movedIds: moved.movedIds };
}
