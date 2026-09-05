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
import { serializeBlocksToMarkdown } from '../markdown/blocks-to-markdown-core';
import type { InlineBackend, MarkdownDegradation, SerializableBlock } from '../markdown/blocks-to-markdown-core';
import { buildDocumentModel } from './document-model';
import type { ViewBlock } from './document-model';
import { needsTokenizing, parseInlineFragment } from './html-text';

import type { LooseOutputData, OutputData } from '../../types';

export type { MarkdownDegradation } from '../markdown/blocks-to-markdown-core';

/** The Markdown of a document plus everything that could not be carried across. */
export interface MarkdownSerializationResult {
  /** The serialized document. */
  markdown: string;
  /** Constructs that were dropped or emitted lossily, in document order. */
  warnings: MarkdownDegradation[];
}

type P5ChildNode = DefaultTreeAdapterMap['childNode'];

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
 */
const serializeNodes = (nodes: P5ChildNode[]): string => nodes.map(serializeNode).join('');

/**
 * Serialize one parse5 node to inline Markdown. Mirrors the tag handling of the
 * DOM backend exactly — the parity test fails on any divergence.
 * @param node - the node to serialize
 */
const serializeNode = (node: P5ChildNode): string => {
  if (node.nodeName === '#text') {
    return (node as DefaultTreeAdapterMap['textNode']).value;
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
    return latex;
  }

  const inner = serializeNodes(node.childNodes);

  switch (node.nodeName) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return inner.trim() === '' ? inner : `**${inner}**`;
    case 'i':
    case 'em':
      return inner.trim() === '' ? inner : `*${inner}*`;
    case 'code':
      return inner.trim() === '' ? inner : `\`${inner}\``;
    case 's':
    case 'del':
    case 'strike':
      return inner.trim() === '' ? inner : `~~${inner}~~`;
    case 'a': {
      const href = attr(node, 'href');

      return href ? `[${inner}](${href})` : inner;
    }
    /**
     * An image has no child nodes, so the `default` branch serializes it to
     * nothing and the image is lost. `alt` and `src` are written raw, exactly
     * as `a` writes its label and `href`.
     */
    case 'img': {
      const src = attr(node, 'src');

      return src ? `![${attr(node, 'alt') ?? ''}](${src})` : '';
    }
    default:
      return inner;
  }
};

/** Reads inline HTML through parse5. Runs anywhere, including bare Node and Jint. */
const parse5InlineBackend: InlineBackend = {
  /**
   * Convert a fragment of inline HTML (a block's `text`) into inline Markdown.
   * @param html - inline HTML string
   */
  inlineToMarkdown(html: string): string {
    const source = html ?? '';

    /**
     * A lone text node serializes to its raw value with no Markdown escaping,
     * so a field the tokenizer would not have changed is already its own
     * Markdown. Reads inline HTML through its own `parseFragment` rather than
     * through `htmlTextContent`, so it needs the guard of its own.
     */
    if (!needsTokenizing(source)) {
      return source;
    }

    return serializeNodes(parseInlineFragment(source).childNodes);
  },
};

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

    out.push({ ...(block.id === undefined ? {} : { id: block.id }),
      parentId,
      tool: block.type,
      data: block.data,
      indent });

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
export const blocksToMarkdown = (data: OutputData | LooseOutputData | null | undefined): string =>
  serializeBlocksToMarkdown(flattenDocument(data), parse5InlineBackend).markdown;

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
  data: OutputData | LooseOutputData | null | undefined
): MarkdownSerializationResult => serializeBlocksToMarkdown(flattenDocument(data), parse5InlineBackend);
