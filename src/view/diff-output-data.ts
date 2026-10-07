/**
 * `diffOutputData` — what changed between two saved documents, block by block.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import type { LooseOutputData, OutputBlockData, OutputData } from '../../types';
import { normalizeOutputBlocks } from '../shared/output-data';
import { outputBlocksToCanonicalSegments } from '../shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../shared/rich-text/fields';
import { deepEqual } from '../shared/deep-equal';
import { htmlToSegmentsNode } from './rich-text-parse5';
import { longestKeptOrder } from './longest-kept-order';

export interface OutputBlockChange {
  id: string;
  before: OutputBlockData;
  after: OutputBlockData;
  fields: Array<'type' | 'data' | 'tunes'>;
}

export interface OutputBlockMove {
  id: string;
  before: OutputBlockData;
  after: OutputBlockData;
}

export interface OutputDataDiff {
  added: OutputBlockData[];
  removed: OutputBlockData[];
  changed: OutputBlockChange[];
  moved: OutputBlockMove[];
}

export interface DiffOutputDataOptions {
  richTextFields?: (type: string) => string[];
}

interface Entry {
  block: OutputBlockData;
  canonical: OutputBlockData;
}

/** The current-field table, not the legacy one: a legacy field stays a string. */
const currentRichTextFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const ROOT = '';

const parentOf = (block: OutputBlockData): string => block.parent ?? ROOT;

/** First block per id; id-less blocks and later duplicates are left out. */
const indexById = (blocks: OutputBlockData[], canonical: OutputBlockData[]): Map<string, Entry> => {
  const byId = new Map<string, Entry>();

  blocks.forEach((block, index) => {
    if (block.id !== undefined && !byId.has(block.id)) {
      byId.set(block.id, { block, canonical: canonical[index] });
    }
  });

  return byId;
};

const changedFields = (before: OutputBlockData, after: OutputBlockData): OutputBlockChange['fields'] => {
  const fields: OutputBlockChange['fields'] = [];

  if (before.type !== after.type) {
    fields.push('type');
  }
  if (!deepEqual(before.data, after.data)) {
    fields.push('data');
  }
  if (!deepEqual(before.tunes ?? {}, after.tunes ?? {})) {
    fields.push('tunes');
  }

  return fields;
};

/** Ids of matched blocks that keep their parent but leave the longest kept order of its children. */
const reorderedIds = (
  afterBlocks: OutputBlockData[],
  beforeById: Map<string, Entry>,
  afterById: Map<string, Entry>
): Set<string> => {
  const positionBefore = new Map<string, number>();
  const siblingCounts = new Map<string, number>();

  beforeById.forEach(({ block }, id) => {
    const count = siblingCounts.get(parentOf(block)) ?? 0;

    positionBefore.set(id, count);
    siblingCounts.set(parentOf(block), count + 1);
  });

  const afterSiblings = new Map<string, string[]>();

  afterBlocks.forEach((block) => {
    const id = block.id;
    const before = id === undefined ? undefined : beforeById.get(id);

    if (id === undefined || before === undefined || afterById.get(id)?.block !== block || parentOf(before.block) !== parentOf(block)) {
      return;
    }
    const siblings = afterSiblings.get(parentOf(block)) ?? [];

    siblings.push(id);
    afterSiblings.set(parentOf(block), siblings);
  });

  const reordered = new Set<string>();

  afterSiblings.forEach((ids) => {
    const kept = new Set(longestKeptOrder(ids.map(id => positionBefore.get(id) ?? 0)));

    ids.forEach((id, index) => {
      if (!kept.has(index)) {
        reordered.add(id);
      }
    });
  });

  return reordered;
};

/**
 * Compare two documents by block id. See types/view.d.ts for the contract.
 * @param before - the older document
 * @param after - the newer document
 * @param options - rich-text fields per tool
 */
export const diffOutputData = (
  before: OutputData | LooseOutputData | null | undefined,
  after: OutputData | LooseOutputData | null | undefined,
  options: DiffOutputDataOptions = {}
): OutputDataDiff => {
  const resolve = options.richTextFields ?? currentRichTextFields;
  const beforeBlocks = normalizeOutputBlocks(before?.blocks ?? []);
  const afterBlocks = normalizeOutputBlocks(after?.blocks ?? []);
  const beforeById = indexById(beforeBlocks, outputBlocksToCanonicalSegments(beforeBlocks, resolve, htmlToSegmentsNode));
  const afterById = indexById(afterBlocks, outputBlocksToCanonicalSegments(afterBlocks, resolve, htmlToSegmentsNode));
  const reordered = reorderedIds(afterBlocks, beforeById, afterById);
  const diff: OutputDataDiff = { added: [], removed: [], changed: [], moved: [] };

  afterBlocks.forEach((block) => {
    const id = block.id;
    const own = id === undefined ? undefined : afterById.get(id);
    const old = id === undefined ? undefined : beforeById.get(id);

    if (id === undefined || own?.block !== block || old === undefined) {
      diff.added.push(block);

      return;
    }

    const fields = changedFields(old.canonical, own.canonical);

    if (fields.length > 0) {
      diff.changed.push({ id, before: old.block, after: block, fields });
    }
    if (parentOf(old.block) !== parentOf(block) || reordered.has(id)) {
      diff.moved.push({ id, before: old.block, after: block });
    }
  });

  beforeBlocks.forEach((block) => {
    const id = block.id;

    if (id === undefined || beforeById.get(id)?.block !== block || !afterById.has(id)) {
      diff.removed.push(block);
    }
  });

  return diff;
};
