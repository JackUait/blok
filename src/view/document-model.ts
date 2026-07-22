/**
 * Normalizes a saved document (`OutputData` or the loose wire shape) into the
 * lookup structures the view renderer walks: defensive per-block
 * normalization plus the flat-with-references hierarchy (`parent`/`content`
 * fields, mirroring what the Saver emits — see `makeOutput` in
 * `src/components/modules/saver.ts`).
 *
 * PURITY CONTRACT: no DOM access, no editor-module imports.
 */
import type { LooseOutputData, OutputData } from '../../types';

/**
 * A block after defensive normalization: guaranteed string `type` and object
 * `data`; `id` present only when it is a non-empty string.
 */
export interface ViewBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Lookup structures for one render run.
 */
export interface DocumentModel {
  /** Blocks with no (or unresolvable/dangling) parent, in document order. */
  topLevel: ViewBlock[];
  /** Every identified block, keyed by id (first occurrence wins). */
  byId: Map<string, ViewBlock>;
  /**
   * Structural children of a block, in document order.
   * @param id - parent block id (undefined → no children)
   */
  childrenOf(id: string | undefined): ViewBlock[];
}

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Normalize one raw block entry from the wire. Returns null for malformed
 * entries (non-objects, missing/empty `type`), which the renderer skips.
 * @param entry - raw entry from a blocks array
 */
export const normalizeViewBlock = (entry: unknown): ViewBlock | null => {
  if (!isRecord(entry) || typeof entry.type !== 'string' || entry.type === '') {
    return null;
  }

  return {
    ...(typeof entry.id === 'string' && entry.id !== '' ? { id: entry.id } : {}),
    type: entry.type,
    data: isRecord(entry.data) ? entry.data : {},
  };
};

/**
 * Read the structural parent reference from a raw block entry. The saved
 * output shape uses `parent`; `parentId` is accepted defensively (it is the
 * field name used by internal serializers).
 * @param entry - raw entry from a blocks array
 */
const parentIdOf = (entry: unknown): string | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const raw = entry.parent ?? entry.parentId;

  return typeof raw === 'string' && raw !== '' ? raw : null;
};

/**
 * Build the document model for one render run.
 * @param input - saved document, tolerant of the loose wire shape and nullish input
 */
export const buildDocumentModel = (input: OutputData | LooseOutputData | null | undefined): DocumentModel => {
  const rawBlocks: unknown[] = Array.isArray(input?.blocks) ? input.blocks : [];

  const entries: Array<{ block: ViewBlock; parentId: string | null }> = [];
  const byId = new Map<string, ViewBlock>();

  for (const raw of rawBlocks) {
    const block = normalizeViewBlock(raw);

    if (block === null) {
      continue;
    }

    entries.push({ block, parentId: parentIdOf(raw) });

    if (block.id !== undefined && !byId.has(block.id)) {
      byId.set(block.id, block);
    }
  }

  const topLevel: ViewBlock[] = [];
  const children = new Map<string, ViewBlock[]>();

  for (const { block, parentId } of entries) {
    /** Dangling/self parents promote the block to root — never drop content. */
    if (parentId === null || parentId === block.id || !byId.has(parentId)) {
      topLevel.push(block);
      continue;
    }

    const siblings = children.get(parentId) ?? [];

    siblings.push(block);
    children.set(parentId, siblings);
  }

  return {
    topLevel,
    byId,
    childrenOf: (id: string | undefined): ViewBlock[] => (id === undefined ? [] : children.get(id) ?? []),
  };
};
