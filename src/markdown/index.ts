import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Root, RootContent } from 'mdast';
import type { PageIcon } from '../../types/tools/page';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { InternalMarkdownImportConfig, MarkdownImportConfig } from './types';
import { mdastToBlocks } from './mdast-to-blocks';
import { safeHref, safeImageSrc, urlScheme } from '../components/utils/sanitize-url';
import type { MarkdownDegradation } from './blocks-to-markdown-core';
import { isBareBreak } from './phrasing-to-html';
import { matchAlert } from './alerts';
import { hasMathSignal, loadMathExtensions } from './math-syntax';
import { splitPageTitle } from '../shared/page-title-icon';

export type { MarkdownImportConfig, ToolMapEntry } from './types';
export type { MarkdownDegradation } from './blocks-to-markdown-core';

/** Imported blocks plus everything Markdown could not carry into them. */
export interface MarkdownImportResult {
  /** Blocks ready for `blok.blocks.render()` or `blok.blocks.insertMany()`. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded, in document order. */
  warnings: MarkdownDegradation[];
  /** The lifted page title. Only with `title: true` and a leading `#` heading. */
  title?: string;
  /** The lifted page icon: a leading emoji and a space in that heading. */
  icon?: PageIcon;
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
    detail: 'Inline math in a paragraph becomes a latex code block, splitting the paragraph around it',
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
 * Whether a node that is lossy elsewhere arrives intact here: a bare `<br>`, or
 * inline math in a table cell or heading, which keep it as an equation mark.
 * @param node - the node to inspect
 * @param parent - its parent, or null at the top level
 */
function keptInline(node: RootContent, parent: RootContent | null): boolean {
  if (node.type === 'html') {
    return isBareBreak(node.value);
  }

  return node.type === 'inlineMath' && (parent?.type === 'tableCell' || parent?.type === 'heading');
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
   * @param parent - its parent, or null at the top level
   */
  const visit = (node: RootContent, parent: RootContent | null): void => {
    const degradation = keptInline(node, parent)
      ? null
      : IMPORT_DEGRADATIONS[node.type] ?? unsafeUrlDegradation(node) ?? blockquoteDegradation(node);

    if (degradation !== undefined && degradation !== null) {
      warnings.push({ ...degradation });
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach((child: RootContent) => visit(child, node));
    }
  };

  tree.children.forEach((child) => visit(child, null));

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
 * The plain text of an inline node: marks are dropped, a break is a space.
 * @param node - the node to read
 */
function plainText(node: RootContent): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'inlineMath') {
    return node.value;
  }

  if (node.type === 'break') {
    return ' ';
  }

  return 'children' in node && Array.isArray(node.children)
    ? (node.children as RootContent[]).map(plainText).join('')
    : '';
}

/**
 * Take a leading `#` heading out of the tree as the page title. Marks in it
 * are dropped: a title is plain text.
 * @param tree - the parsed document, changed in place
 * @returns the title and icon, or nothing when there is no such heading
 */
function liftTitle(tree: Root): { title?: string; icon?: PageIcon; marked?: boolean } {
  const first = tree.children[0];

  if (first?.type !== 'heading' || first.depth !== 1) {
    return {};
  }

  const lifted = splitPageTitle(first.children.map(plainText).join(''));

  if (lifted.title === '') {
    return {};
  }

  tree.children.shift();

  return first.children.some((child) => child.type !== 'text') ? { ...lifted, marked: true } : lifted;
}

const TITLE_MARKS_DROPPED: MarkdownDegradation = {
  construct: 'heading',
  action: 'degraded',
  detail: 'The page title is plain text, so the formatting in the leading heading is dropped',
};

/**
 * Convert a Markdown string to blocks and report what degraded on the way in.
 *
 * The blocks are identical to {@link markdownToBlocks}; reach for this when the
 * caller has to be told what Markdown could not carry — an MCP or agent client
 * writing a document it will later read back.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns the blocks and their degradations, plus the lifted title with `title: true`
 */
export async function markdownToBlocksWithReport(
  md: string,
  config: MarkdownImportConfig = {}
): Promise<MarkdownImportResult> {
  const enableGfm = config.gfm !== false;
  const hasMath = hasMathSignal(md);

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

  const internal: InternalMarkdownImportConfig = config;
  const { marked, ...page } = config.title === true ? liftTitle(tree) : {};

  if (internal.softBreaks === true) {
    tree.children.forEach(softBreaksToBreaks);
  }

  return { blocks: mdastToBlocks(tree, config, internal.htmlText === true ? 'html' : 'segments'),
    // The heading came first, so its warning does too.
    warnings: [...(marked === true ? [{ ...TITLE_MARKS_DROPPED }] : []), ...collectImportWarnings(tree)],
    ...page };
}
