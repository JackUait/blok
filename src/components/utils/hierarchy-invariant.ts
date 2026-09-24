import type { OutputBlockData } from '@/types';
import type { BlockId } from '../../../types/data-formats/block-id';
import { CHILD_SLOT_SELECTOR, SELF_PLACING_PARENTS } from '../../tools/nested-blocks';

import { resolveHomeSlot } from './home-slot';

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

/**
 * A live block, as the placement and flat-order checks read it. Fields are
 * optional because saver unit fixtures pass partial stubs.
 */
export interface LiveBlockInput {
  id: string;
  name: string;
  parentId: string | null;
  holder?: Element;
}

export interface HomeSlotViolation {
  kind: 'holder-outside-home-slot';
  blockId: string;
  message: string;
}

/**
 * Detect holders mounted outside their HOME SLOT: the child slot of the
 * nearest ancestor that owns one (see {@link resolveHomeSlot}), or the editor
 * root when no ancestor does. A holder elsewhere renders outside its container
 * and escapes its collapse.
 *
 * Skipped, because nothing can be judged there:
 * - a holder that is not in the document (the stranded check owns that);
 * - a home slot, or the root area, that is not in the document (detached
 *   editor, not-yet-mounted parent);
 * - blocks a table/database places itself (per cell / per view);
 * - an ancestor without a holder (partial stubs).
 *
 * An adapter slot that has not committed yet reads as slotless, so its
 * children are expected where core parks them meanwhile: no special case.
 * @param blocks - the live blocks
 * @param rootArea - the editor working area; null when unknown, then a root
 *   block is only flagged when it sits directly in a child slot
 */
export const validateHomeSlots = (blocks: LiveBlockInput[], rootArea: Element | null): HomeSlotViolation[] => {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const getBlock = (id: string): { holder: Element | undefined; name: string; parentId: string | null } | undefined => {
    const block = byId.get(id);

    return block === undefined ? undefined : { holder: block.holder, name: block.name, parentId: block.parentId };
  };
  // Siblings share a home; each resolve walks ancestors with a querySelector per hop.
  const homeByParent = new Map<string | null, ReturnType<typeof resolveHomeSlot>>();

  return blocks.flatMap((block): HomeSlotViolation[] => {
    const holder = block.holder;

    if (holder === undefined || !holder.isConnected) {
      return [];
    }

    const parent = block.parentId !== null ? byId.get(block.parentId) : undefined;

    if (parent !== undefined && SELF_PLACING_PARENTS.has(parent.name)) {
      return [];
    }

    // A column_list never mounts a non-column child and evicts it to root on
    // the next settled frame (ColumnList.scheduleRogueEviction); a save before
    // that frame is a known transient, not a lost block.
    if (parent?.name === 'column_list' && block.name !== 'column') {
      return [];
    }

    const home = homeByParent.get(block.parentId) ?? resolveHomeSlot(block.parentId, getBlock);

    homeByParent.set(block.parentId, home);
    const actual = holder.parentElement;

    const misplaced = ((): boolean => {
      if (home.kind === 'slot') {
        return home.slot.isConnected && actual !== home.slot;
      }

      if (home.kind !== 'root') {
        return false;
      }

      if (rootArea !== null) {
        return rootArea.isConnected && actual !== rootArea;
      }

      return actual?.matches(CHILD_SLOT_SELECTOR) === true;
    })();

    if (!misplaced) {
      return [];
    }

    const where = home.kind === 'slot' ? 'the child slot of its nearest slot-owning ancestor' : 'the editor root';

    return [{
      kind: 'holder-outside-home-slot' as const,
      blockId: block.id,
      message: `Block ${block.id} (parent ${String(block.parentId)}) is outside its home slot: its holder belongs directly in ${where}`,
    }];
  });
};

export interface FlatOrderViolation {
  kind: 'flat-order-not-depth-first';
  index: number;
  expected: string | undefined;
  actual: string | undefined;
  message: string;
}

/**
 * Detect a flat block array that is not a depth-first walk of the tree: each
 * block must be followed right away by all its descendants. Save order,
 * keyboard navigation and flat-index DOM anchoring all assume it.
 *
 * Sibling order is the flat order, not `contentIds`: the saver derives
 * `content[]` from the flat array and tolerates a stale `contentIds`
 * (saver.test.ts pins that). A dangling parentId counts as root, as in the
 * saver output.
 * @param blocks - the flat block array
 */
export const validateFlatOrder = (blocks: LiveBlockInput[]): FlatOrderViolation[] => {
  const ids = new Set(blocks.map(b => b.id));
  const effectiveParent = (b: LiveBlockInput): string | null =>
    b.parentId !== null && ids.has(b.parentId) ? b.parentId : null;
  const childrenInFlatOrder = new Map<string, string[]>();

  for (const b of blocks) {
    const parentId = effectiveParent(b);

    if (parentId !== null) {
      childrenInFlatOrder.set(parentId, [...(childrenInFlatOrder.get(parentId) ?? []), b.id]);
    }
  }

  const byId = new Map(blocks.map(b => [b.id, b]));
  const expected: string[] = [];
  const visited = new Set<string>();
  const walk = (b: LiveBlockInput): void => {
    if (visited.has(b.id)) {
      return;
    }
    visited.add(b.id);
    expected.push(b.id);

    for (const childId of childrenInFlatOrder.get(b.id) ?? []) {
      const child = byId.get(childId);

      if (child !== undefined) {
        walk(child);
      }
    }
  };

  blocks.filter(b => effectiveParent(b) === null).forEach(walk);

  const length = Math.max(expected.length, blocks.length);
  const index = Array.from({ length }, (_, i) => i).find(i => expected[i] !== blocks[i]?.id);

  if (index === undefined) {
    return [];
  }

  const around = (list: Array<string | undefined>): string => list.slice(Math.max(0, index - 2), index + 3).map(String).join(',');

  return [{
    kind: 'flat-order-not-depth-first',
    index,
    expected: expected[index],
    actual: blocks[index]?.id,
    message:
      `Flat block order is not depth-first at index ${index}: expected ${String(expected[index])}, found ${String(blocks[index]?.id)} ` +
      `(flat ${around(blocks.map(b => b.id))} vs tree ${around(expected)})`,
  }];
};

export const assertHierarchy = (blocks: OutputBlockData[], context: string): void => {
  const violations = validateHierarchy(blocks);

  if (violations.length === 0) {
    return;
  }
  const summary = violations.map(v => `  - ${v.message}`).join('\n');

  throw new Error(`Hierarchy invariant violated at ${context}:\n${summary}`);
};
