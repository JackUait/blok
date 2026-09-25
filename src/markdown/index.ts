import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Extension as MicromarkExtension } from 'micromark-util-types';
import type { Root, RootContent } from 'mdast';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { InternalMarkdownImportConfig, MarkdownImportConfig } from './types';
import { mdastToBlocks } from './mdast-to-blocks';
import { safeHref, safeImageSrc, urlScheme } from '../components/utils/sanitize-url';
import type { MarkdownDegradation } from './blocks-to-markdown-core';
import { isBareBreak } from './phrasing-to-html';
import { matchAlert } from './alerts';

export type { MarkdownImportConfig, ToolMapEntry } from './types';
export type { MarkdownDegradation } from './blocks-to-markdown-core';

/** Imported blocks plus everything Markdown could not carry into them. */
export interface MarkdownImportResult {
  /** Blocks ready for `blok.blocks.render()` or `blok.blocks.insertMany()`. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded, in document order. */
  warnings: MarkdownDegradation[];
}

/**
 * Does the source look like it carries math? Gates the extension load.
 *
 * A `$` followed by a digit opens a price, not a formula: without that guard
 * `$5-$10` parses as inline math and tears the paragraph into a latex code
 * block plus two fragments. Real math almost never opens on a bare digit.
 */
const MATH_SIGNAL = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?![\s\d$])[^$]+(?<=\S)\$(?!\$)/;

/**
 * Lazily load math micromark/mdast extensions only when needed.
 */
async function loadMathExtensions(): Promise<{
  mathSyntax: MicromarkExtension;
  mathFromMarkdown: MdastExtension;
}> {
  const [{ math }, { mathFromMarkdown }] = await Promise.all([
    import('micromark-extension-math'),
    import('mdast-util-math'),
  ]);

  return { mathSyntax: math(), mathFromMarkdown: mathFromMarkdown() };
}

/**
 * Convert a Markdown string to an array of Blok OutputBlockData.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns Array of OutputBlockData ready for `blok.blocks.render()` or `blok.blocks.insertMany()`
 */
export async function markdownToBlocks(md: string, config: MarkdownImportConfig = {}): Promise<OutputBlockData[]> {
  return (await markdownToBlocksWithReport(md, config)).blocks;
}

/**
 * What each lossy construct costs on the way in, keyed by mdast node type.
 *
 * Blok has no raw-HTML block, no math block and no footnote block, so all three
 * arrive changed or not at all. Reporting them from one tree walk keeps a
 * collector out of every node handler.
 */
const IMPORT_DEGRADATIONS: Record<string, MarkdownDegradation> = {
  html: {
    construct: 'html',
    action: 'degraded',
    detail: 'HTML is escaped and stored as literal text; Blok has no raw-HTML block',
  },
  inlineMath: {
    construct: 'inlineMath',
    action: 'degraded',
    detail: 'Inline math becomes a latex code block, splitting the paragraph around it',
  },
  footnoteReference: {
    construct: 'footnoteReference',
    action: 'dropped',
    detail: 'Footnote references are removed; Blok has no footnote block',
  },
  footnoteDefinition: {
    construct: 'footnoteDefinition',
    action: 'dropped',
    detail: 'The footnote body is dropped; Blok has no footnote block',
  },
};

/**
 * What an unsafe scheme costs, if the node carries one.
 *
 * Refusing the scheme is the sanitizer working as intended, but the refusal was
 * silent: an image disappears entirely and a link keeps its text while losing
 * where it pointed, and a caller reading only the report saw full fidelity.
 * @param node - the node to inspect
 * @returns the degradation, or null when nothing was refused
 */
function unsafeUrlDegradation(node: RootContent): MarkdownDegradation | null {
  if (node.type !== 'image' && node.type !== 'link') {
    return null;
  }

  /** No explicit scheme is nothing to refuse — a relative or anchor URL passes. */
  const scheme = urlScheme(node.url);

  if (scheme === null) {
    return null;
  }

  if (node.type === 'image') {
    return safeImageSrc(node.url) === null
      ? { construct: 'image',
        action: 'dropped',
        detail: `${scheme} is not an allowed scheme; the image was removed` }
      : null;
  }

  return safeHref(node.url) === null
    ? { construct: 'link',
      action: 'degraded',
      detail: `${scheme} is not an allowed scheme; the link target was removed` }
    : null;
}

/**
 * A quote holds one inline field, so the importer lifts a code block, list or
 * nested quote out of it as its own block. An alert is exempt: it becomes a
 * callout, which holds child blocks.
 * @param node - the node to inspect
 * @returns the degradation, or null when the quote holds only paragraphs
 */
function blockquoteDegradation(node: RootContent): MarkdownDegradation | null {
  if (node.type !== 'blockquote' || matchAlert(node) !== null || node.children.every((child) => child.type === 'paragraph')) {
    return null;
  }

  return { construct: 'blockquote',
    action: 'degraded',
    detail: 'A quote holds only text, so its code blocks, lists and nested quotes become separate blocks after the quote text' };
}

/**
 * Collect every degradation the import leaves behind.
 *
 * @param tree - the parsed Markdown tree
 * @returns one degradation per lossy node, in document order
 */
function collectImportWarnings(tree: Root): MarkdownDegradation[] {
  const warnings: MarkdownDegradation[] = [];

  /**
   * Visit one node and its children.
   * @param node - the node to visit
   */
  const visit = (node: RootContent): void => {
    const degradation = node.type === 'html' && isBareBreak(node.value)
      ? null
      : IMPORT_DEGRADATIONS[node.type] ?? unsafeUrlDegradation(node) ?? blockquoteDegradation(node);

    if (degradation !== undefined && degradation !== null) {
      warnings.push({ ...degradation });
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  tree.children.forEach(visit);

  return warnings;
}

/**
 * Split every text node at its soft line endings into `break` nodes, in place.
 * Code keeps its newlines: its value lives in `code`/`inlineCode`, not `text`.
 * @param node - the subtree to rewrite
 */
function softBreaksToBreaks(node: RootContent): void {
  if (!('children' in node) || !Array.isArray(node.children)) {
    return;
  }

  const children = node.children as RootContent[];

  children.forEach(softBreaksToBreaks);
  children.splice(0, children.length, ...children.flatMap((child): RootContent[] => child.type === 'text' && child.value.includes('\n')
    ? child.value.split('\n').flatMap((value, index): RootContent[] => [
      ...(index > 0 ? [{ type: 'break' } as const] : []),
      ...(value !== '' ? [{ type: 'text', value } as const] : []),
    ])
    : [child]));
}

/**
 * Convert a Markdown string to blocks and report what degraded on the way in.
 *
 * The blocks are identical to {@link markdownToBlocks}; reach for this when the
 * caller has to be told what Markdown could not carry — an MCP or agent client
 * writing a document it will later read back.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns the blocks and their degradations
 */
export async function markdownToBlocksWithReport(
  md: string,
  config: MarkdownImportConfig = {}
): Promise<MarkdownImportResult> {
  const enableGfm = config.gfm !== false;
  const hasMath = MATH_SIGNAL.test(md);

  const extensions = [
    ...(enableGfm ? [gfm()] : []),
    ...(config.extensions ?? []),
  ];

  const mdastExtensions = [
    ...(enableGfm ? [gfmFromMarkdown()] : []),
    ...(config.mdastExtensions ?? []),
  ];

  if (hasMath) {
    const { mathSyntax, mathFromMarkdown } = await loadMathExtensions();

    extensions.push(mathSyntax);
    mdastExtensions.push(mathFromMarkdown);
  }

  const tree = fromMarkdown(md, {
    extensions,
    mdastExtensions,
  });

  if ((config as InternalMarkdownImportConfig).softBreaks === true) {
    tree.children.forEach(softBreaksToBreaks);
  }

  return { blocks: mdastToBlocks(tree, config),
    warnings: collectImportWarnings(tree) };
}
