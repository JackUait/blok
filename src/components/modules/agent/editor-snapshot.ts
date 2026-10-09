import { DocSnapshot } from '../../../shared/agent/snapshot';
import { outputBlocksToSegments } from '../../../shared/rich-text/block-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';
import { editorRichTextFieldsFor } from './editor-ports';

export const editorSnapshot = (Blok: Pick<BlokModules, 'Tools' | 'YjsManager'>): DocSnapshot => {
  const fieldsFor = editorRichTextFieldsFor(Blok);
  const blocks = Blok.YjsManager.toJSON().map(block => ({
    ...block,
    data: Object.fromEntries(Object.entries(block.data).map(([key, value]) =>
      [key, fieldsFor(block.type).includes(key)
        ? Blok.YjsManager.richSegmentsOf(value) ?? htmlToSegmentsDom(typeof value === 'string' ? value : '')
        : value])),
  }));

  return DocSnapshot.fromOutput({
    ...Blok.YjsManager.getPageFields(),
    blocks: outputBlocksToSegments(blocks, fieldsFor, htmlToSegmentsDom),
  });
};

export const createRevisionCounter = (Blok: Pick<BlokModules, 'YjsManager'>): { value(): string; dispose(): void } => {
  const state = { count: 0 };
  const dispose = Blok.YjsManager.onAnyDocUpdate(() => {
    state.count++;
  });

  return { value: () => `e${state.count}`, dispose };
};
