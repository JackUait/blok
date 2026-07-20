/**
 * Public utilities for working with saved editor documents (`OutputData`).
 *
 * Consumers persisting editor content need two recurring predicates that the
 * editor itself already relies on internally:
 *
 * - structural equality, to dedupe the `data → render → onSave → data` echo
 *   round-trip without clobbering the caret;
 * - emptiness, to decide whether a document carries any user content
 *   (placeholder states, "save" button gating, skipping empty submissions).
 *
 * Both accept the loose wire shape (`data: null`, `id: null`, nullish
 * documents) so backend DTOs can be passed as-is.
 */
import { deepEqual } from './deep-equal';

import type { LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData } from '../../types';

type AnyOutputData = OutputData | LooseOutputData | null | undefined;

/**
 * Compares two blocks structurally. The `id` participates only when BOTH
 * blocks carry one: the editor mints a fresh id whenever content arrives
 * without one (see {@link normalizeOutputBlocks}), so an id-less origin
 * document must still compare equal to its saved echo.
 * @param a - first block to compare
 * @param b - second block to compare
 * @returns true when the blocks are structurally equal
 */
function equalsOutputBlock(
  a: OutputBlockData | LooseOutputBlockData,
  b: OutputBlockData | LooseOutputBlockData
): boolean {
  const { id: idA, ...restA } = a;
  const { id: idB, ...restB } = b;

  const hasIdA = typeof idA === 'string' && idA !== '';
  const hasIdB = typeof idB === 'string' && idB !== '';

  if (hasIdA && hasIdB && idA !== idB) {
    return false;
  }

  return deepEqual(restA, restB);
}

/**
 * Structural equality for saved documents. Compares the `blocks` arrays
 * deeply; the volatile `time` and `version` envelope fields are ignored, so a
 * document round-tripped through `save()` compares equal to its echo. Block
 * ids are compared only when both sides carry one — the editor mints fresh
 * ids for id-less content, so a legacy document still equals its saved echo.
 * Nullish documents compare equal to `{ blocks: [] }`.
 * @param a - first document to compare
 * @param b - second document to compare
 * @returns true when both documents hold structurally equal blocks
 */
export function equalsOutputData(a: AnyOutputData, b: AnyOutputData): boolean {
  const blocksA = a?.blocks ?? [];
  const blocksB = b?.blocks ?? [];

  return blocksA.length === blocksB.length && blocksA.every((block, index) => equalsOutputBlock(block, blocksB[index]));
}

/**
 * A bounded window of the editor's recently emitted `onSave` payloads, used by
 * the framework adapters to recognize controlled-`data` echoes. Deduping
 * against only the LAST emitted payload is not enough: a host that persists on
 * save and refetches can hand the adapter a STALE echo — an earlier save
 * arriving after a newer one already replaced the baseline — and re-rendering
 * it would clobber the caret and any content typed since. Matching is
 * structural ({@link equalsOutputData}), so envelopes reshaped in transit
 * (fresh `time`, stripped ids) still count as echoes.
 * @param capacity - number of payloads retained before the oldest is evicted
 * @returns the echo window
 */
export function createEmittedEchoWindow(capacity: number = 20): {
  /** Records a payload the editor emitted via `onSave`. */
  record(data: OutputData | LooseOutputData): void;
  /** True when the document content-equals any recorded payload. */
  matches(data: AnyOutputData): boolean;
  /** Forgets all recorded payloads (external content took over). */
  clear(): void;
} {
  const emitted: Array<OutputData | LooseOutputData> = [];

  return {
    record(data: OutputData | LooseOutputData): void {
      emitted.push(data);
      if (emitted.length > capacity) {
        emitted.shift();
      }
    },
    matches(data: AnyOutputData): boolean {
      return emitted.some((payload) => equalsOutputData(payload, data));
    },
    clear(): void {
      emitted.length = 0;
    },
  };
}

/**
 * Normalizes blocks from the loose wire shape into the strict saved shape at
 * the editor's input boundaries: a `null`/missing `data` becomes `{}`, a
 * `null`/empty `id` is dropped so the block factory generates a fresh one.
 * Idempotent — strict blocks pass through unchanged (shallow-copied).
 * @param blocks - blocks in either the strict or the loose wire shape
 * @returns blocks in the strict saved shape
 */
export function normalizeOutputBlocks(blocks: Array<OutputBlockData | LooseOutputBlockData>): OutputBlockData[] {
  return blocks.map((block) => {
    const { id, data, ...rest } = block;

    return {
      ...rest,
      ...(typeof id === 'string' && id !== '' ? { id } : {}),
      data: data ?? {},
    };
  });
}

/**
 * True when the value carries no user content: blank/whitespace-only strings,
 * empty arrays, plain objects whose values are all empty, and nullish values.
 * Numbers and booleans are presentation metadata (`level`, `checked`, styles)
 * and never count as content on their own.
 * @param value - block data value to inspect
 * @returns true when the value carries no user content
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (Array.isArray(value)) {
    return value.every(isEmptyValue);
  }

  if (typeof value === 'object') {
    return Object.values(value).every(isEmptyValue);
  }

  // Numbers, booleans and other primitives are metadata, not content.
  return true;
}

/**
 * True when the document carries no user content: it is nullish, has no
 * blocks, or every block's data holds only empty values (see
 * {@link isEmptyValue}). Note that content-less visual blocks (e.g. a divider,
 * whose data is `{}`) count as empty — check `blocks.length` when mere block
 * presence matters.
 * @param data - document to inspect
 * @returns true when the document carries no user content
 */
export function isEmptyOutputData(data: AnyOutputData): boolean {
  const blocks = data?.blocks ?? [];

  return blocks.every((block) => isEmptyValue(block.data));
}
