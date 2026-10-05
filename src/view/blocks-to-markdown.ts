/**
 * `blocksToMarkdown` — synchronous, DOM-free Markdown serialization of a saved
 * Blok document. The twin of the editor's clipboard serializer
 * (`src/markdown/blocks-to-markdown.ts`): both delegate every block-level
 * decision to `blocks-to-markdown-core.ts` and differ only in how they read a
 * block's inline HTML — a live DOM there, parse5 here.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*, parse5).
 */
import type { DefaultTreeAdapterMap } from 'parse5';

import { EQUATION_SOURCE_ATTR } from '../shared/equation-mark';
import {
  HARD_BREAK,
  RAW_TEXT,
  codeSpan,
  inlineEquation,
  inlineLosses,
  markdownDestination,
  markdownTextEscaper,
  serializeBlocksToMarkdown
} from '../markdown/blocks-to-markdown-core';
import type { InlineBackend, MarkdownDegradation, SerializableBlock, TextEscaper } from '../markdown/blocks-to-markdown-core';
import { buildDocumentModel } from './document-model';
import type { ViewBlock } from './document-model';
import { needsTokenizing, parseInlineFragment } from './html-text';

import type { LooseOutputData, OutputData } from '../../types';
import type { BlocksToHtmlOptions } from './blocks-to-html';
import { isPagePointer } from '../shared/page-pointer';
import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../shared/page-reference';

export type { MarkdownDegradation } from '../markdown/blocks-to-markdown-core';

/** The Markdown of a document plus everything that could not be carried across. */
export interface MarkdownSerializationResult {
  /** The serialized document. */
  markdown: string;
  /** Constructs that were dropped or emitted lossily, in document order. */
  warnings: MarkdownDegradation[];
}

type P5ChildNode = DefaultTreeAdapterMap['childNode'];

/** Receives the name of every inline construct the walk had to unwrap. */
type LossReporter = (construct: string) => void;

/**
 * Read an attribute off a parse5 element.
 * @param node - the node to read
 * @param name - attribute name
 */
const attr = (node: P5ChildNode, name: string): string | null => {
  if (!('attrs' in node)) {
    return null;
  }

  return node.attrs.find((candidate) => candidate.name === name)?.value ?? null;
};

/**
 * Serialize parse5 child nodes to inline Markdown.
 * @param nodes - nodes to walk
 * @param onLoss - receives every unwrapped inline construct
 * @param escape - escapes text node values
 */
const serializeNodes = (
  nodes: P5ChildNode[],
  onLoss: LossReporter,
  escape: TextEscaper,
  pageInfo: BlocksToHtmlOptions['pageInfo']
): string => nodes.map((node) => serializeNode(node, onLoss, escape, pageInfo)).join('');

/**
 * Serialize one parse5 node to inline Markdown. Mirrors the tag handling of the
 * DOM backend exactly — the parity test fails on any divergence.
 * @param node - the node to serialize
 * @param onLoss - receives every unwrapped inline construct
 * @param escape - escapes text node values
 */
const serializeNode = (
  node: P5ChildNode,
  onLoss: LossReporter,
  escape: TextEscaper,
  pageInfo: BlocksToHtmlOptions['pageInfo']
): string => {
  if (node.nodeName === '#text') {
    return escape((node as DefaultTreeAdapterMap['textNode']).value);
  }

  if (!('childNodes' in node)) {
    return '';
  }

  /**
   * An inline equation reads as its SOURCE, never as its children: those are a
   * KaTeX rendering cache. See the law in `src/shared/equation-mark.ts`.
   */
  const latex = attr(node, EQUATION_SOURCE_ATTR);

  if (latex !== null) {
    return inlineEquation(latex);
  }

  const pageId = node.nodeName === 'a' ? attr(node, PAGE_REFERENCE_ATTR) : null;

  if (pageId) {
    const info = pageInfo?.(pageId);
    const title = info !== null && info !== undefined && info.access !== 'none' && typeof info.title === 'string' && info.title.trim() !== ''
      ? info.title
      : PAGE_REFERENCE_FALLBACK;

    return markdownTextEscaper(title)(title);
  }

  const inner = serializeNodes(node.childNodes, onLoss, node.nodeName === 'code' ? RAW_TEXT : escape, pageInfo);

  switch (node.nodeName) {
    case 'br':
      return HARD_BREAK;
    case 'b':
    case 'strong':
      return inner.trim() === '' ? inner : `**${inner}**`;
    case 'i':
    case 'em':
      return inner.trim() === '' ? inner : `*${inner}*`;
    case 'code':
      return inner.trim() === '' ? inner : codeSpan(inner);
    case 's':
    case 'del':
    case 'strike':
      return inner.trim() === '' ? inner : `~~${inner}~~`;
    case 'a': {
      const href = markdownDestination(attr(node, 'href') ?? '', 'href');

      return href ? `[${inner}](${href})` : inner;
    }
    /**
     * An image has no child nodes, so the `default` branch serializes it to
     * nothing and the image is lost. `alt` is text, escaped like a link's
     * label; `src` goes through the same URL check as `href`.
     */
    case 'img': {
      const src = markdownDestination(attr(node, 'src') ?? '', 'src');

      return src ? `![${escape(attr(node, 'alt') ?? '')}](${src})` : '';
    }
    default:
      inlineLosses(node.nodeName, attr(node, 'style')).forEach(onLoss);

      return inner;
  }
};

/** Reads inline HTML through parse5. Runs anywhere, including bare Node and Jint. */
const parse5InlineBackend = (pageInfo: BlocksToHtmlOptions['pageInfo']): InlineBackend => ({
  /**
   * Convert a fragment of inline HTML (a block's `text`) into inline Markdown.
   * @param html - inline HTML string
   * @param onLoss - receives every unwrapped inline construct
   */
  inlineToMarkdown(html: string, onLoss: LossReporter = (): void => {}): string {
    const source = html ?? '';
    const escape = markdownTextEscaper(source);

    /**
     * A field the tokenizer would not change is one text node, so it is
     * escaped directly. Reads inline HTML through its own `parseFragment`
     * rather than through `htmlTextContent`, so it needs the guard of its own.
     */
    if (!needsTokenizing(source)) {
      return escape(source);
    }

    return serializeNodes(parseInlineFragment(source).childNodes, onLoss, escape, pageInfo);
  },
});

/**
 * Flatten a saved document into the core's block list, in reading order —
 * top-level blocks then their structural descendants — stamping each block's
 * `indent` with its parent-chain depth.
 * @param data - saved document
 */
const flattenDocument = (data: OutputData | LooseOutputData | null | undefined): SerializableBlock[] => {
  const model = buildDocumentModel(data);
  const out: SerializableBlock[] = [];
  const seen = new Set<string>();

  /**
   * Append one block and its descendants.
   * @param block - block to append
   * @param parentId - id of its structural parent
   * @param indent - parent-chain depth
   */
  const visit = (block: ViewBlock, parentId: string | null, indent: number): void => {
    if (block.id !== undefined) {
      if (seen.has(block.id)) {
        return;
      }
      seen.add(block.id);
    }

    const leafPage = isPagePointer(block.type, block.data) || block.type === 'page-link';
    const unresolvedChildIds = leafPage ? [] : model.unresolvedContentOf(block.id);

    out.push({ ...(block.id === undefined ? {} : { id: block.id }),
      parentId,
      tool: block.type,
      data: block.data,
      indent,
      ...(unresolvedChildIds.length > 0 ? { unresolvedChildIds } : {}) });

    if (leafPage) {
      return;
    }

    for (const child of model.childrenOf(block.id)) {
      visit(child, block.id ?? null, indent + 1);
    }
  };

  for (const block of model.topLevel) {
    visit(block, null, 0);
  }

  return out;
};

/**
 * Serialize a saved Blok document to Markdown, synchronously and DOM-free.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns Markdown ('' for empty/malformed documents)
 */
export const blocksToMarkdown = (
  data: OutputData | LooseOutputData | null | undefined,
  options: Pick<BlocksToHtmlOptions, 'pageInfo'> = {}
): string => serializeBlocksToMarkdown(flattenDocument(data), parse5InlineBackend(options.pageInfo), options.pageInfo).markdown;

/**
 * Serialize a saved Blok document to Markdown and report what degraded.
 *
 * Markdown cannot express every Blok construct — a callout becomes a
 * blockquote, columns flatten, a spacer disappears. A consumer handing the
 * result to something that cannot ask a follow-up question (an AI client, an
 * export) needs to know which of those happened, which is what the report is
 * for; the Markdown itself is identical to {@link blocksToMarkdown}.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns the Markdown and its degradations
 */
export const blocksToMarkdownWithReport = (
  data: OutputData | LooseOutputData | null | undefined,
  options: Pick<BlocksToHtmlOptions, 'pageInfo'> = {}
): MarkdownSerializationResult => serializeBlocksToMarkdown(flattenDocument(data), parse5InlineBackend(options.pageInfo), options.pageInfo);
