import type { AgentWarning } from '../../types/agent';
import type { SanitizerConfig, ToolSanitizerConfig } from '../../types/configs/sanitizer-config';
import type { OutputBlockData, OutputData } from '../../types/data-formats/output-data';
import { markdownToBlocksWithReport } from '../markdown';
import type { AgentPorts } from '../shared/agent/types';
import { mintId } from '../shared/mint-id';
import { protectPageReferenceAnchor } from '../shared/page-reference';
import { outputBlocksToSegments } from '../shared/rich-text/block-data';
import { isRichText } from '../shared/rich-text/guards';
import { segmentsToHtml } from '../shared/rich-text/segments-to-html';
import { getEffectiveRuleForString, isPlaintextRule, walkSanitize, type StringCleaner } from '../shared/sanitize-walk';
import { hasUnsafeUrlProtocol } from '../shared/url-policy';
import { blocksToMarkdownWithReport } from './blocks-to-markdown';
import { htmlToSegmentsNode } from './rich-text-parse5';
import { sanitizeHtmlFragment } from './sanitize';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

// Match the editor's no-DOM URL pass without importing html-janitor.
const URL_ATTR = /\s*(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
const stripUnsafeUrlAttributes = (html: string): string => html.indexOf('<') === -1 ? html : html.replace(
  URL_ATTR,
  (match: string, attribute: string, dq?: string, sq?: string, uq?: string) =>
    hasUnsafeUrlProtocol(dq ?? sq ?? uq ?? '', attribute.toLowerCase()) ? '' : match
);

const cleanHeadless: StringCleaner = (value, rule, globalRules) => {
  if (isPlaintextRule(rule)) {
    return value;
  }

  const effective = getEffectiveRuleForString(rule, globalRules);

  if (effective === null) {
    return stripUnsafeUrlAttributes(value);
  }

  const anchorRule = effective.a;

  return sanitizeHtmlFragment(value,
    anchorRule !== undefined && anchorRule !== false && typeof anchorRule !== 'string'
      ? { ...effective, a: protectPageReferenceAnchor(anchorRule) }
      : effective);
};

const urlsOnly = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return stripUnsafeUrlAttributes(value);
  }
  if (isArray(value)) {
    return value.map(urlsOnly);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, urlsOnly(item)]));
  }

  return value;
};

export const createHeadlessPorts = (input: {
  sanitizeFor(type: string): ToolSanitizerConfig | undefined;
  richTextFieldsFor(type: string): string[];
  globalSanitizer?: SanitizerConfig;
  openPageDocument?: AgentPorts['openPageDocument'];
  newId?: () => string;
}): AgentPorts => {
  const global = input.globalSanitizer ?? {};

  return {
    htmlToSegments: htmlToSegmentsNode,
    sanitizeBlockData: (type, data) => {
      const rich = input.richTextFieldsFor(type);
      const html = Object.fromEntries(Object.entries(data).map(([key, value]): [string, unknown] =>
        [key, rich.includes(key) && isRichText(value) ? segmentsToHtml(value) : value]));
      const rules = input.sanitizeFor(type) ?? {};
      const cleaned = Object.keys(rules).length === 0 && Object.keys(global).length === 0
        ? urlsOnly(html)
        : walkSanitize(html, rules, global, cleanHeadless);

      if (!isRecord(cleaned)) {
        throw new Error('Expected sanitized block data');
      }

      return Object.fromEntries(Object.entries(cleaned).map(([key, value]): [string, unknown] =>
        [key, rich.includes(key) && typeof value === 'string' ? htmlToSegmentsNode(value) : value]));
    },
    markdownToBlocks: async (md) => {
      const { blocks, warnings } = await markdownToBlocksWithReport(md);

      return {
        blocks: outputBlocksToSegments(blocks, input.richTextFieldsFor, htmlToSegmentsNode),
        warnings: warnings.map((item): AgentWarning => ({
          code: 'MARKDOWN_DEGRADED',
          message: `${item.construct} ${item.action}: ${item.detail}`,
        })),
      };
    },
    blocksToMarkdown: (doc) => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc);

      return {
        markdown,
        warnings: warnings.map((item): AgentWarning => ({
          code: 'MARKDOWN_DEGRADED',
          message: `${item.construct} ${item.action}: ${item.detail}`,
        })),
      };
    },
    newId: input.newId ?? (() => mintId()),
    ...(input.openPageDocument !== undefined && { openPageDocument: input.openPageDocument }),
  };
};

export const loadStoredDocument = (
  doc: OutputData,
  richTextFieldsFor: (type: string) => string[],
): OutputData => {
  const reserved = new Set<string>();
  const reserve = (value: unknown): void => {
    if (typeof value === 'string' && value !== '') {
      reserved.add(value);
    }
  };
  const reserveTableRow = (row: unknown): void => {
    if (!isArray(row)) {
      return;
    }
    for (const cell of row) {
      if (isRecord(cell) && isArray(cell.blocks)) {
        cell.blocks.forEach(reserve);
      }
    }
  };

  // Reserve dangling references too, so repairs cannot create their targets.
  for (const block of doc.blocks) {
    reserve(block.id);
    reserve(block.parent);
    block.content?.forEach(reserve);

    if (block.type !== 'table' || !isArray(block.data.content)) {
      continue;
    }
    for (const row of block.data.content) {
      reserveTableRow(row);
    }
  }

  const seen = new Set<string>();
  const blocks = doc.blocks.map((block): OutputBlockData => {
    const original = block.id;

    if (typeof original === 'string' && original !== '' && !seen.has(original)) {
      seen.add(original);

      return block;
    }

    const candidate = { id: mintId() };

    while (candidate.id === '' || reserved.has(candidate.id)) {
      candidate.id = mintId();
    }
    const { id } = candidate;

    reserved.add(id);
    seen.add(id);

    const repaired = { ...block, id };

    // A duplicate's self-parent must not become a link to the first record.
    if (typeof original === 'string' && original !== '' && block.parent === original) {
      delete repaired.parent;
    }

    return repaired;
  });

  return { ...doc, blocks: outputBlocksToSegments(blocks, richTextFieldsFor, htmlToSegmentsNode) };
};

export type { OutputBlockData };
