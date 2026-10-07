import type { BlockToolData } from '../../../types';
import type { BlockToolAdapter } from '../tools/block';
import { blockDataToSegments, nestedDocumentsFor } from '../../shared/rich-text/block-data';
import { htmlToSegmentsDom } from './rich-text-dom';

/**
 * Internal HTML → segments for the host.
 * Returns `data` itself when nothing converts, so callers can tell nothing changed.
 * @param tool - the block's tool
 * @param data - block data as the tool saved it
 * @param resolveTool - looks up the tools of nested documents' blocks
 */
export const richTextOutputForHost = (
  tool: BlockToolAdapter,
  data: BlockToolData,
  resolveTool: (name: string) => BlockToolAdapter | undefined
): BlockToolData => blockDataToSegments(
  data,
  // Test doubles and hand-built adapters may lack the getter.
  tool.richTextFields ?? [],
  type => resolveTool(type)?.richTextFields ?? [],
  htmlToSegmentsDom,
  nestedDocumentsFor(tool.name)
);
