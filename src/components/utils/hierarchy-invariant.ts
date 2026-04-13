import type { OutputBlockData } from '@/types';
import type { BlockId } from '../../../types/data-formats/block-id';

/**
 * Hierarchy invariant validator.
 *
 * Every block with `parent: X` must appear in `X.content`, and every id in a
 * block's `content[]` must resolve to a block whose `parent` points back. Any
 * drift between the two representations is the signature of the callout paste
 * ejection bug (and its siblings across toggle, toggleable header, list, and
 * any future container block).
 *
 * This util exists so tests and saver-level assertions can detect drift at
 * any point in the pipeline — load, save, collapse, or post-mutation — without
 * hand-rolling the same loop. Treat it as the single source of truth for the
 * parent/content invariant.
 */

export interface HierarchyViolation {
  kind:
    | 'child-parent-missing'
    | 'child-not-in-parent-content'
    | 'content-id-dangling'
    | 'content-parent-mismatch'
    | 'content-duplicate';
  blockId: BlockId | undefined;
  parentId?: BlockId;
  childId?: BlockId;
  message: string;
}

const pushViolation = (violations: HierarchyViolation[], v: HierarchyViolation): void => {
  violations.push(v);
};

const checkParentLinks = (
  block: OutputBlockData,
  blockById: Map<BlockId, OutputBlockData>,
  violations: HierarchyViolation[]
): void => {
  if (block.parent === undefined || block.parent === null) {
    return;
  }
  const parent = blockById.get(block.parent);

  if (parent === undefined) {
    pushViolation(violations, {
      kind: 'child-parent-missing',
      blockId: block.id,
      parentId: block.parent,
      message: `Block ${String(block.id)} references missing parent ${String(block.parent)}`,
    });

    return;
  }
  if (block.id === undefined || !Array.isArray(parent.content) || !parent.content.includes(block.id)) {
    pushViolation(violations, {
      kind: 'child-not-in-parent-content',
      blockId: block.id,
      parentId: block.parent,
      message: `Block ${String(block.id)} has parent=${String(block.parent)} but that parent's content[] does not include it`,
    });
  }
};

const checkContentArray = (
  block: OutputBlockData,
  blockById: Map<BlockId, OutputBlockData>,
  violations: HierarchyViolation[]
): void => {
  if (!Array.isArray(block.content)) {
    return;
  }
  const seen = new Set<BlockId>();

  for (const childId of block.content) {
    if (seen.has(childId)) {
      pushViolation(violations, {
        kind: 'content-duplicate',
        blockId: block.id,
        childId,
        message: `Block ${String(block.id)}.content[] contains duplicate id ${String(childId)}`,
      });
      continue;
    }
    seen.add(childId);

    const child = blockById.get(childId);

    if (child === undefined) {
      pushViolation(violations, {
        kind: 'content-id-dangling',
        blockId: block.id,
        childId,
        message: `Block ${String(block.id)}.content[] references missing child ${String(childId)}`,
      });
      continue;
    }
    if (child.parent !== block.id) {
      pushViolation(violations, {
        kind: 'content-parent-mismatch',
        blockId: block.id,
        childId,
        message: `Block ${String(block.id)}.content[] includes ${String(childId)} but that child's parent is ${String(child.parent)}`,
      });
    }
  }
};

export const validateHierarchy = (blocks: OutputBlockData[]): HierarchyViolation[] => {
  const violations: HierarchyViolation[] = [];
  const blockById = new Map<BlockId, OutputBlockData>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      blockById.set(block.id, block);
    }
  }

  for (const block of blocks) {
    checkParentLinks(block, blockById, violations);
    checkContentArray(block, blockById, violations);
  }

  return violations;
};

export const assertHierarchy = (blocks: OutputBlockData[], context: string): void => {
  const violations = validateHierarchy(blocks);

  if (violations.length === 0) {
    return;
  }
  const summary = violations.map(v => `  - ${v.message}`).join('\n');

  throw new Error(`Hierarchy invariant violated at ${context}:\n${summary}`);
};
