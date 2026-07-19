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

/**
 * Resolve the build/runtime environment in a way that works in BROWSERS too.
 *
 * The long-standing `typeof process !== 'undefined' ? process.env?.NODE_ENV :
 * undefined` pattern silently disables every dev/test gate in a real browser:
 * Vite's `define` inlines the literal, but the vestigial `typeof process`
 * guard still evaluates false at runtime, so e2e runs never asserted anything.
 * Reading `process.env.NODE_ENV` directly lets the bundler substitute the
 * literal at build time (dev serve and `--mode test` builds get their mode,
 * production builds get dead-code-eliminated); the try/catch covers any
 * environment where neither the define nor a real `process` exists.
 */
export const resolveRuntimeEnv = (): string | undefined => {
  try {
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
};

/**
 * A repository block whose holder can be checked for document attachment.
 */
export interface HolderAttachmentInput {
  id: BlockId | undefined;
  /** Undefined when the caller works with partial stubs (e.g. saver unit fixtures) — such blocks are not assessable and never flagged. */
  holder: Element | undefined;
  parentId?: BlockId | null;
}

/**
 * Stranded-holder violation: a block that the model still owns but whose
 * holder is not connected to the document.
 */
export interface HolderAttachmentViolation {
  kind: 'holder-stranded';
  blockId: BlockId | undefined;
  message: string;
}

/**
 * Detect blocks stranded in detached DOM: the block is alive in the model,
 * but its holder is not connected to the document — so the content is
 * invisible, unreachable, and (from the user's point of view) lost, while
 * every save still claims it exists.
 *
 * This is the signature of the toggle-heading level-convert data-loss bug:
 * replace() removed the old container subtree with the children's holders
 * still inside it, and the reparent mount was vetoed, leaving the children
 * parked in the dead subtree forever.
 *
 * Precision rule: a block is stranded exactly when its own PARENT's holder is
 * connected but its holder is not — the parent is visible while the child is
 * gone. Anchoring on the parent (not "any holder in the document") keeps unit
 * fixtures honest: tests routinely attach one holder to jsdom's body while
 * unrelated blocks stay detached, and that is not a strand.
 */
export const validateHolderAttachment = (blocks: HolderAttachmentInput[]): HolderAttachmentViolation[] => {
  const byId = new Map<BlockId, HolderAttachmentInput>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      byId.set(block.id, block);
    }
  }

  return blocks
    .filter(b => {
      if (b.holder === undefined || b.holder.isConnected || b.parentId === undefined || b.parentId === null) {
        return false;
      }

      const parent = byId.get(b.parentId);

      return parent?.holder !== undefined && parent.holder.isConnected;
    })
    .map(b => ({
      kind: 'holder-stranded' as const,
      blockId: b.id,
      message: `Block ${String(b.id)} is stranded: its parent ${String(b.parentId)} is in the document but the block's holder is detached`,
    }));
};

export const assertHierarchy = (blocks: OutputBlockData[], context: string): void => {
  const violations = validateHierarchy(blocks);

  if (violations.length === 0) {
    return;
  }
  const summary = violations.map(v => `  - ${v.message}`).join('\n');

  throw new Error(`Hierarchy invariant violated at ${context}:\n${summary}`);
};
