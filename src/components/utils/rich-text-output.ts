import type { BlockToolData } from '../../../types';
import type { BlockToolAdapter } from '../tools/block';
import { blockDataToSegments } from '../../shared/rich-text/block-data';
import { htmlToSegmentsDom } from './rich-text-dom';

/**
 * Internal HTML → what the host asked for. A no-op in the default 'html'
 * format, under collaboration, and with legacy output (same gates as the Saver).
 * The no-op returns `data` itself, so callers can tell nothing changed.
 * @param tool - the block's tool
 * @param data - block data as the tool saved it
 * @param resolveTool - looks up the tools of nested documents' blocks
 * @param options - the Saver's two fallback gates
 */
export const richTextOutputForHost = (
  tool: BlockToolAdapter,
  data: BlockToolData,
  resolveTool: (name: string) => BlockToolAdapter | undefined,
  options: { collaborating: boolean; legacyOutput: boolean }
): BlockToolData => (tool.richTextFormat === 'segments' && !options.collaborating && !options.legacyOutput
  ? blockDataToSegments(data, tool.richTextFields, type => resolveTool(type)?.richTextFields ?? [], htmlToSegmentsDom)
  : data);
