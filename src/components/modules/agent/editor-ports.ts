import type { AgentWarning } from '../../../../types/agent';
import { blocksToMarkdownWithReport } from '../../../markdown/blocks-to-markdown';
import type { MarkdownDegradation } from '../../../markdown/blocks-to-markdown';
import type { AgentPorts } from '../../../shared/agent/types';
import {
  blockDataToSegments,
  nestedDocumentsFor,
  outputBlocksToHtml,
  outputBlocksToSegments,
} from '../../../shared/rich-text/block-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { generateBlockId } from '../../utils/id-generator';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';

export const editorRichTextFieldsFor = (Blok: Pick<BlokModules, 'Tools'>): (type: string) => string[] =>
  (type) => Blok.Tools.blockTools.get(type)?.richTextFields ?? [];

const degraded = (item: MarkdownDegradation): AgentWarning => ({
  code: 'MARKDOWN_DEGRADED',
  message: `${item.construct} ${item.action}: ${item.detail}`,
});

export const createEditorPorts = (Blok: BlokModules): AgentPorts => {
  const fieldsFor = editorRichTextFieldsFor(Blok);

  return {
    htmlToSegments: htmlToSegmentsDom,
    sanitizeBlockData: (type, data) => {
      const rich = fieldsFor(type);
      const cleaned = Blok.BlocksAPI.hostDataForTool(type, data);

      return blockDataToSegments(cleaned, rich, fieldsFor, htmlToSegmentsDom, nestedDocumentsFor(type));
    },
    markdownToBlocks: async (md) => {
      const { markdownToBlocksWithReport } = await import('../../../markdown/index');
      const { blocks, warnings } = await markdownToBlocksWithReport(md);

      return {
        blocks: outputBlocksToSegments(blocks, fieldsFor, htmlToSegmentsDom),
        warnings: warnings.map(degraded),
      };
    },
    blocksToMarkdown: (doc) => {
      const blocks = outputBlocksToHtml(doc.blocks, fieldsFor);
      const parentOf = new Map<string, string | null>();

      for (const block of blocks) {
        if (block.id !== undefined) {
          parentOf.set(block.id, block.parent ?? null);
        }
      }

      const depthOf = (id: string | undefined, seen: Set<string> = new Set()): number => {
        if (id === undefined || seen.has(id)) {
          return 0;
        }

        const parent = parentOf.get(id);

        if (typeof parent !== 'string') {
          return 0;
        }

        seen.add(id);

        return 1 + depthOf(parent, seen);
      };
      const { markdown, warnings } = blocksToMarkdownWithReport(blocks.map((block) => ({
        id: block.id,
        tool: block.type,
        data: block.data,
        parentId: block.parent ?? null,
        ...(block.content !== undefined ? { contentIds: block.content } : {}),
        indent: depthOf(block.id),
      })));

      return { markdown, warnings: warnings.map(degraded) };
    },
    newId: generateBlockId,
  };
};
