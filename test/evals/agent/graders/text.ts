import type { OutputBlockData, OutputData } from '../../../../types';
import type { RichTextSegment } from '../../../../types/rich-text';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-node';

export type BlockRef = { id: string } | { type: string; nth?: number };

const isSegment = (value: unknown): value is RichTextSegment =>
  value !== null && typeof value === 'object' && ('text' in value || 'embed' in value);

export const segmentsOf = (block: OutputBlockData, field = 'text'): RichTextSegment[] => {
  const value = block.data[field];

  if (typeof value === 'string') {
    return htmlToSegmentsNode(value);
  }

  return Array.isArray(value) ? value.filter(isSegment) : [];
};

/** An embed counts as one object-replacement character, as in the editor. */
export const plainText = (block: OutputBlockData, field = 'text'): string =>
  segmentsOf(block, field).map((s) => ('text' in s ? s.text : '￼')).join('');

export const blockById = (doc: OutputData, id: string): OutputBlockData | undefined => doc.blocks.find((b) => b.id === id);

export const childrenOf = (doc: OutputData, block: OutputBlockData): OutputBlockData[] => {
  const listed = (block.content ?? []).map((id) => blockById(doc, id)).filter((b): b is OutputBlockData => b !== undefined);

  return listed.length > 0 ? listed : doc.blocks.filter((b) => b.parent !== undefined && b.parent === block.id);
};

export const rootsOf = (doc: OutputData): OutputBlockData[] => doc.blocks.filter((b) => b.parent === undefined || b.parent === null);

/** Document order: roots, each followed by its subtree. */
export const inOrder = (doc: OutputData): OutputBlockData[] => {
  const out: OutputBlockData[] = [];
  const walk = (block: OutputBlockData): void => {
    out.push(block);
    childrenOf(doc, block).forEach(walk);
  };

  rootsOf(doc).forEach(walk);

  return out;
};

export const resolveBlock = (doc: OutputData, ref: BlockRef): OutputBlockData | undefined =>
  'id' in ref ? blockById(doc, ref.id) : inOrder(doc).filter((b) => b.type === ref.type)[ref.nth ?? 0];
