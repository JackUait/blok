/**
 * `diffOutputData` — what changed between two saved documents, block by block.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import type { LooseOutputData, OutputData } from '../../types';
import { diffOutput } from '../shared/output-diff';
import type { DiffOutputDataOptions, OutputDataDiff } from '../shared/output-diff';
import { htmlToSegmentsNode } from './rich-text-node';

export type { DiffOutputDataOptions, OutputBlockChange, OutputBlockMove, OutputDataDiff } from '../shared/output-diff';

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
): OutputDataDiff => diffOutput(before, after, { ...options, htmlToSegments: htmlToSegmentsNode });
