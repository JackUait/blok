import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { Dom as dom$ } from '../../../dom';
import { ensureStrongElement } from '../../../inline-tools/utils/bold-dom-utils';
import type { BlockToolAdapter } from '../../../tools/block';
import { isObject } from '../../../utils';
import { applyLinkConfig } from '../../../utils/apply-link-config';
import { clean } from '../../../utils/sanitizer';
import { COLUMNS_CANDIDATE_ATTR, SAFE_STRUCTURAL_TAGS, collectTagNames } from '../constants';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';


/**
 * A node queued for block mapping, optionally expanded out of a container
 * (DETAILS/ASIDE children, columns-candidate table cells).
 */
interface ExpandedNodeEntry {
  node: Node;
  /** Index of this entry's parent within the expanded list. */
  parentExpandedIndex?: number;
  /** Fixed tool name bypassing tag substitution (column_list / column). */
  toolOverride?: string;
  /** Creation-time tool data (e.g. noSeed) for synthesized containers. */
  toolData?: Record<string, unknown>;
  /** Keep the entry even though its content is empty (layout containers). */
  keepEmpty?: boolean;
}

/**
 * HTML Handler Priority.
 * Handles HTML string content.
 */
export class HtmlHandler extends BasePasteHandler implements PasteHandler {
  private readonly linkConfig?: BlokConfig['link'];

  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    config?: BlokConfig
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
    this.linkConfig = config?.link;
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    if (!data.trim() || !dom$.isHTMLString(data)) {
      return 0;
    }

    return 40;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const dataToInsert = this.processHTML(data);

    if (!dataToInsert.length) {
      return false;
    }

    await this.insertPasteData(dataToInsert, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Split HTML string to blocks and return it as array of Block data.
   */
  private processHTML(innerHTML: string): PasteData[] {
    const { Tools } = this.Blok;

    const wrapper = dom$.make('DIV');

    wrapper.innerHTML = innerHTML;

    // Normalize legacy <b> → <strong> on the DETACHED wrapper, before the block
    // is rendered and the caret lands inside the pasted content. The live bold
    // MutationObserver deliberately skips any <b> that contains the caret (to
    // avoid scrambling actively-typed collapsed-bold), and on paste the caret is
    // moved to the block END — landing inside a freshly pasted <b> — so that
    // observer would leave it as <b> forever. Converting here (no caret present)
    // is race-free and mirrors the preprocessNestedLists pre-splitter pass. Note
    // the wrapper is detached, so BoldNormalizationPass (which only converts
    // CONNECTED nodes) is a no-op here — ensureStrongElement swaps in place.
    wrapper.querySelectorAll('b').forEach(bold => ensureStrongElement(bold));

    // Quote is a leaf tool: its onPaste stores innerHTML as inline rich text
    // and its sanitizer strips list tags — a list left inside a <blockquote>
    // would silently flatten on save. Split lists out first, then stamp them.
    this.splitListsOutOfBlockquotes(wrapper);

    // Notion/GDocs wrap quote text in <p>; the registered P tag would force
    // the blockquote to descend into loose paragraphs and lose quote-ness.
    this.unwrapBlockquoteParagraphs(wrapper);

    // Preserve nested-list depth and ordered/unordered context BEFORE the splitter
    // detaches each <li> from its ancestor <ul>/<ol> during sanitization.
    this.preprocessNestedLists(wrapper);

    // Apply the editor's `link` config to pasted anchors before they are split
    // into blocks, mirroring the interactive Link inline tool. Pasted `<a>`
    // would otherwise keep their original (foreign) target/rel/href.
    if (this.linkConfig !== undefined) {
      applyLinkConfig(wrapper, this.linkConfig);
    }

    const nodes = this.getNodes(wrapper);

    // Pre-expand DETAILS nodes: extract child elements (non-summary) before
    // sanitization strips them, and carry a parentExpandedIndex reference so
    // we can remap to final post-filter indices later.
    const expandedNodes: ExpandedNodeEntry[] = [];

    for (const node of nodes) {
      // A Google-Docs single-row table stamped as a columns candidate becomes
      // a column layout instead of a table block.
      if (this.isColumnsCandidateTable(node)) {
        this.expandTableToColumnEntries(node as HTMLElement, expandedNodes);
        continue;
      }

      const isDetailsElement =
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).tagName === 'DETAILS';
      const isAsideElement =
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).tagName === 'ASIDE';

      if (!isDetailsElement && !isAsideElement) {
        expandedNodes.push({ node });
        continue;
      }

      const parentExpandedIndex = expandedNodes.length;

      expandedNodes.push({ node });

      // Only direct children are extracted (not deeply nested structures), which
      // is correct for Google Docs DETAILS format where children are flat siblings.
      // For ASIDE, ALL children become child blocks (no SUMMARY to skip).
      const childElements = Array.from((node as HTMLElement).children).filter(
        (child) => isAsideElement || child.tagName !== 'SUMMARY'
      );

      for (const child of childElements) {
        expandedNodes.push({ node: child, parentExpandedIndex });
      }
    }

    // Map expanded nodes to intermediate results, preserving original index.
    type MappedEntry = { data: PasteData; originalIndex: number; keepEmpty?: boolean } | null;

    const mapped: MappedEntry[] = expandedNodes.map(({ node, parentExpandedIndex, toolOverride, toolData, keepEmpty }, originalIndex) => {
      // Synthesized container entries (column_list / column) bypass the tag
      // substitution and sanitization below: their tool is fixed, and their
      // content is an empty placeholder the tool never reads.
      if (toolOverride !== undefined) {
        const content = node as HTMLElement;

        return {
          data: {
            content,
            isBlock: true,
            tool: toolOverride,
            event: this.composePasteEvent('tag', { data: content }),
            parentPasteIndex: parentExpandedIndex,
            toolData,
          },
          originalIndex,
          keepEmpty,
        };
      }

      const nodeData = (() => {
        switch (node.nodeType) {
          case Node.DOCUMENT_FRAGMENT_NODE: {
            const fragmentWrapper = dom$.make('div');

            fragmentWrapper.appendChild(node);

            return {
              content: fragmentWrapper,
              tool: Tools.defaultTool,
              isBlock: false,
            };
          }

          case Node.ELEMENT_NODE: {
            const elementContent = node as HTMLElement;
            const tagSubstitute = this.toolRegistry.findToolForTag(elementContent.tagName) ?? undefined;

            return {
              content: elementContent,
              tool: tagSubstitute?.tool ?? Tools.defaultTool,
              isBlock: true,
            };
          }

          default:
            return null;
        }
      })();

      if (!nodeData) {
        return null;
      }

      const { content, tool, isBlock } = nodeData;

      const toolTags = this.buildToolTags(tool);

      const structuralSanitizeConfig = this.sanitizerBuilder.getStructuralTagsConfig(content);
      const customConfig: SanitizerConfig = { ...structuralSanitizeConfig, ...toolTags, ...tool.baseSanitizeConfig, br: {} };
      const sanitizedContent = this.sanitizeContent(content, customConfig);

      if (!sanitizedContent) {
        return null;
      }

      const event = this.composePasteEvent('tag', {
        data: sanitizedContent,
      });

      return {
        data: {
          content: sanitizedContent,
          isBlock,
          tool: tool.name,
          event,
          parentPasteIndex: parentExpandedIndex,
        },
        originalIndex,
      };
    });

    // Filter, tracking the mapping from original (expandedNodes) index → final index.
    const oldToNewIndex = new Map<number, number>();
    const filtered: PasteData[] = [];

    for (const entry of mapped) {
      if (!entry) {
        continue;
      }
      const { data, originalIndex, keepEmpty } = entry;
      const isContentEmpty = dom$.isEmpty(data.content);
      const isSingleTag = dom$.isSingleTag(data.content);

      if (!isContentEmpty || isSingleTag || keepEmpty === true) {
        oldToNewIndex.set(originalIndex, filtered.length);
        filtered.push(data);
      }
    }

    // Remap parentPasteIndex from expandedNodes indices to final filtered indices.
    for (const item of filtered) {
      if (item.parentPasteIndex !== undefined) {
        // undefined means parent was filtered out → child becomes root-level
        item.parentPasteIndex = oldToNewIndex.get(item.parentPasteIndex);
      }
    }

    return filtered;
  }

  /**
   * Stamp each pasted `<li>` with the context the list tool needs AFTER the
   * splitter clones/detaches it from its ancestor `<ul>`/`<ol>`, then flatten
   * nested lists so every `<li>` becomes a separate emittable block.
   *
   * Generic web pages carry nested-list depth purely in DOM structure (no
   * `aria-level`), and the list style purely in the ancestor `<ul>`/`<ol>` tag.
   * Both are lost once a single `<li>` is cloned in isolation, so we record them
   * as attributes while the ancestor chain is intact:
   *   - `aria-level` = 1-based nesting depth (read by extractDepthFromPastedContent)
   *   - `data-list-style="ordered"` for items inside an `<ol>` (read by
   *     detectStyleFromPastedContent). We only stamp the ordered case so that
   *     unordered/checklist items keep flowing through the existing checkbox
   *     detection path.
   * Existing `aria-level`/`data-list-style` (e.g. from Google Docs) win and are
   * never overwritten.
   */
  /**
   * Whether a node is a table stamped by the Google Docs preprocessor as a
   * columns candidate that can actually be expanded: 2 or 3 uniform columns
   * and both column tools registered. Anything else falls back to the
   * regular table substitution.
   */
  private isColumnsCandidateTable(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const table = node as HTMLElement;

    if (table.tagName !== 'TABLE' || !table.hasAttribute(COLUMNS_CANDIDATE_ATTR)) {
      return false;
    }

    const { blockTools } = this.Blok.Tools;

    if (!blockTools.has('column_list') || !blockTools.has('column')) {
      return false;
    }

    return this.columnCellGroups(table).length >= 2;
  }

  /**
   * The table's cells grouped by column: element `j` holds column `j`'s cells
   * in row order. Returns an empty array unless every row has the same cell
   * count of 2 or 3 (defensive re-check of the preprocessor's stamp — ragged
   * rows or merged cells mean genuinely tabular data).
   */
  private columnCellGroups(table: HTMLElement): HTMLElement[][] {
    const ownRows = Array.from(table.querySelectorAll('tr'))
      .filter((row) => row.closest('table') === table);

    const rowCells = ownRows.map((row) => Array.from(row.children)
      .filter((child): child is HTMLElement => child.tagName === 'TD' || child.tagName === 'TH'));

    const columnCount = rowCells[0]?.length ?? 0;

    if ((columnCount !== 2 && columnCount !== 3) || rowCells.some((cells) => cells.length !== columnCount)) {
      return [];
    }

    return Array.from({ length: columnCount }, (_, columnIndex) =>
      rowCells.map((cells) => cells[columnIndex]));
  }

  /**
   * Expand a columns-candidate table into a column layout: one `column_list`
   * entry, one `column` entry per table column, and the column's cells'
   * content (top-to-bottom across rows) as entries parented to its column.
   * The containers carry `noSeed` so they don't self-populate before the
   * pasted children are parented to them; a column whose cells are all EMPTY
   * omits it so the column seeds its own paragraph instead of lingering as a
   * dead empty box.
   */
  private expandTableToColumnEntries(table: HTMLElement, expandedNodes: ExpandedNodeEntry[]): void {
    const listIndex = expandedNodes.length;

    expandedNodes.push({
      node: dom$.make('div'),
      toolOverride: 'column_list',
      toolData: { noSeed: true },
      keepEmpty: true,
    });

    for (const cells of this.columnCellGroups(table)) {
      const contentEntries = cells.flatMap((cell) => this.collectCellContentEntries(cell));
      const columnIndex = expandedNodes.length;

      expandedNodes.push({
        node: dom$.make('div'),
        toolOverride: 'column',
        // noFocus: pasted columns must never grab the caret away from the
        // paste position (mirrors ColumnList.seedColumns' focus discipline).
        toolData: contentEntries.length > 0 ? { noSeed: true, noFocus: true } : { noFocus: true },
        keepEmpty: true,
        parentExpandedIndex: listIndex,
      });

      for (const entry of contentEntries) {
        expandedNodes.push({ ...entry, parentExpandedIndex: columnIndex });
      }
    }
  }

  /**
   * Split a cell's content into block-mappable entries: block-level or
   * tool-substitutable element children become their own entries; runs of
   * inline content between them are grouped into a wrapper that maps to the
   * default tool (paragraph). A `<br>` splits inline runs — the Google Docs
   * preprocessor encodes the cell's original `<p>` boundaries as `<br>`
   * (html-janitor unwraps block elements nested in `<td>`), so each line
   * becomes its own paragraph block again.
   */
  private collectCellContentEntries(cell: HTMLElement): ExpandedNodeEntry[] {
    const tags = Object.keys(this.toolRegistry.toolsTags);
    const entries: ExpandedNodeEntry[] = [];
    const inlineRun: { current: HTMLElement | null } = { current: null };

    const flushInlineRun = (): void => {
      const run = inlineRun.current;

      if (run !== null && (!dom$.isEmpty(run) || dom$.isSingleTag(run))) {
        entries.push({ node: run });
      }
      inlineRun.current = null;
    };

    for (const child of Array.from(cell.childNodes)) {
      const isElement = child.nodeType === Node.ELEMENT_NODE;

      if (isElement && (child as HTMLElement).tagName === 'BR') {
        flushInlineRun();
        continue;
      }

      const isBlockChild =
        isElement &&
        (tags.includes((child as HTMLElement).tagName) ||
          dom$.blockElements.includes((child as HTMLElement).tagName.toLowerCase()));

      if (isBlockChild) {
        flushInlineRun();
        entries.push({ node: child });
        continue;
      }

      inlineRun.current = inlineRun.current ?? dom$.make('div');
      inlineRun.current.appendChild(child.cloneNode(true));
    }

    flushInlineRun();

    return entries;
  }

  /**
   * Split direct-child `<ul>`/`<ol>` elements out of every `<blockquote>`,
   * preserving document order: lead content stays in the quote, the list
   * becomes its next sibling, trailing content continues in a new quote.
   * A quote left with no text is removed. Repeats until stable (each split
   * strictly reduces the count of lists parented by a blockquote).
   *
   * @param wrapper - detached element holding the pasted document
   */
  private splitListsOutOfBlockquotes(wrapper: HTMLElement): void {
    const isListElement = (candidate: Element): boolean =>
      candidate.tagName === 'UL' || candidate.tagName === 'OL';

    while (true) {
      const quote = Array.from(wrapper.querySelectorAll('blockquote'))
        .find((candidate) => Array.from(candidate.children).some(isListElement));

      if (quote === undefined) {
        return;
      }

      const children = Array.from(quote.childNodes);
      const list = children.find(
        (child): child is HTMLElement => child instanceof HTMLElement && isListElement(child)
      ) as HTMLElement;

      const trailingQuote = quote.cloneNode(false) as HTMLElement;

      children.slice(children.indexOf(list) + 1).forEach((child) => trailingQuote.appendChild(child));

      quote.after(list);

      if ((trailingQuote.textContent ?? '').trim() !== '') {
        list.after(trailingQuote);
      }

      if ((quote.textContent ?? '').trim() === '') {
        quote.remove();
      }
    }
  }

  /**
   * Unwrap direct `<p>` children of every `<blockquote>` into inline content
   * separated by `<br>`, so the blockquote substitutes into ONE quote block.
   * `<p>` is registered to the paragraph tool, which otherwise marks the
   * blockquote as containing another tool's tag and forces it to descend
   * into loose paragraph blocks — quote-ness silently lost.
   *
   * @param wrapper - detached element holding the pasted document
   */
  private unwrapBlockquoteParagraphs(wrapper: HTMLElement): void {
    wrapper.querySelectorAll('blockquote').forEach((quote) => {
      Array.from(quote.children)
        .filter((child): child is HTMLElement => child.tagName === 'P')
        .forEach((paragraph) => {
          const hasContentBefore =
            paragraph.previousElementSibling !== null ||
            (paragraph.previousSibling?.textContent ?? '').trim() !== '';

          if (hasContentBefore) {
            paragraph.before(document.createElement('br'));
          }

          paragraph.replaceWith(...Array.from(paragraph.childNodes));
        });
    });
  }

  private preprocessNestedLists(wrapper: HTMLElement): void {
    const listItems = Array.from(wrapper.querySelectorAll('li'));

    for (const li of listItems) {
      const listAncestors = this.listAncestors(li);
      const ancestorListCount = listAncestors.length;
      const nearestList = listAncestors[0] ?? null;

      if (ancestorListCount > 0 && !li.hasAttribute('aria-level')) {
        li.setAttribute('aria-level', String(ancestorListCount));
      }

      // Only stamp for generic ordered lists that carry NO explicit per-item
      // `list-style-type` — Google-Docs/Word items already encode their own style
      // there and must keep driving detection (an item's own style-type wins over
      // its ancestor tag).
      const hasExplicitListStyleType = /list-style-type\s*:/i.test(li.getAttribute('style') ?? '');

      if (nearestList?.tagName === 'OL' && !li.hasAttribute('data-list-style') && !hasExplicitListStyleType) {
        li.setAttribute('data-list-style', 'ordered');
      }
    }

    // Hoist every list that is a direct child of an `<li>` out to become the
    // item's next sibling, so each `<li>` is a leaf the splitter emits on its
    // own. Depth is preserved by the stamped `aria-level`. Repeat until stable;
    // each hoist strictly reduces the count of `<li>`-parented lists.
    while (this.hoistNestedListsOnce(wrapper)) {
      // Repeat until no list remains directly parented by an `<li>`.
    }
  }

  /**
   * Collect a list item's ancestor `<ul>`/`<ol>` elements, nearest-first.
   * @param element - the element whose list ancestors to collect
   * @returns the ancestor list elements ordered from nearest to farthest
   */
  private listAncestors(element: HTMLElement): HTMLElement[] {
    const parent = element.parentElement;

    if (parent === null) {
      return [];
    }

    const higher = this.listAncestors(parent);

    return parent.tagName === 'UL' || parent.tagName === 'OL'
      ? [parent, ...higher]
      : higher;
  }

  /**
   * Hoist every list directly parented by an `<li>` out to become the item's
   * next sibling in a single pass.
   * @param wrapper - the container being normalized
   * @returns true if at least one list was hoisted (loop again), false when stable
   */
  private hoistNestedListsOnce(wrapper: HTMLElement): boolean {
    return Array.from(wrapper.querySelectorAll('ul, ol')).reduce((moved, nestedList) => {
      const parent = nestedList.parentElement;

      if (parent !== null && parent.tagName === 'LI') {
        parent.after(nestedList);

        return true;
      }

      return moved;
    }, false);
  }

  /**
   * Build sanitizer config for a tool's tags.
   */
  private buildToolTags(tool: BlockToolAdapter): SanitizerConfig {
    if (tool.pasteConfig === false) {
      return {};
    }

    const tagsOrSanitizeConfigs = tool.pasteConfig?.tags || [];

    return tagsOrSanitizeConfigs.reduce<SanitizerConfig>((result: SanitizerConfig, tagOrSanitizeConfig: string | SanitizerConfig) => {
      const tags = collectTagNames(tagOrSanitizeConfig);
      const nextResult: SanitizerConfig = { ...result };

      tags.forEach((tag) => {
        const sanitizationConfig = isObject(tagOrSanitizeConfig)
          ? (tagOrSanitizeConfig)[tag]
          : null;

        nextResult[tag.toLowerCase()] = sanitizationConfig ?? {};
      });

      return nextResult;
    }, {} as SanitizerConfig);
  }

  /**
   * Sanitize content with special handling for tables.
   */
  private sanitizeContent(element: HTMLElement, config: SanitizerConfig): HTMLElement | null {
    if (element.tagName.toLowerCase() !== 'table') {
      const result = element.cloneNode(true) as HTMLElement;
      result.innerHTML = clean(element.innerHTML, config);

      return result;
    }

    return this.sanitizerBuilder.sanitizeTable(element, config);
  }

  /**
   * Fetch nodes from Element node.
   */
  private processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void {
    const tags = Object.keys(this.toolRegistry.toolsTags);

    const element = node as HTMLElement;

    const tagSubstitute = this.toolRegistry.findToolForTag(element.tagName);
    const tool = tagSubstitute?.tool;
    const toolTags = tool ? this.toolRegistry.getToolTags(tool.name) : [];

    const isSubstitutable = tags.includes(element.tagName);

    // DETAILS and ASIDE are container-type substitutable elements. Always return
    // them as atomic blocks so the tool's onPaste receives the full element
    // (including children), rather than having them split into flat blocks when
    // the paragraph tool's <p> registration triggers containsAnotherToolTags = true.
    if (isSubstitutable && (element.tagName === 'DETAILS' || element.tagName === 'ASIDE')) {
      return [...nodes, destNode, element];
    }

    const isBlockElement = dom$.blockElements.includes(element.tagName.toLowerCase());
    const isStructuralElement = SAFE_STRUCTURAL_TAGS.has(element.tagName.toLowerCase());
    const containsAnotherToolTags = Array
      .from(element.children)
      .some(
        ({ tagName }) => tags.includes(tagName) && !toolTags.includes(tagName)
      );

    const containsBlockElements = Array.from(element.children).some(
      ({ tagName }) => dom$.blockElements.includes(tagName.toLowerCase())
    );

    if (!isBlockElement && !isSubstitutable && !containsAnotherToolTags) {
      destNode.appendChild(element);

      return [...nodes, destNode];
    }

    if (
      (isSubstitutable && !containsAnotherToolTags) ||
      (isBlockElement && !containsBlockElements && !containsAnotherToolTags) ||
      (isStructuralElement && !containsAnotherToolTags)
    ) {
      return [...nodes, destNode, element];
    }
  }

  /**
   * Recursively divide HTML string to two types of nodes.
   */
  private getNodes(wrapper: Node): Node[] {
    const children = Array.from(wrapper.childNodes);

    const reducer = (nodes: Node[], node: Node): Node[] => {
      if (dom$.isEmpty(node) && !dom$.isSingleTag(node as HTMLElement)) {
        return nodes;
      }

      const lastNode = nodes[nodes.length - 1];
      const isLastNodeFragment = lastNode !== undefined && dom$.isFragment(lastNode);
      const { destNode, remainingNodes } = isLastNodeFragment
        ? {
          destNode: lastNode,
          remainingNodes: nodes.slice(0, -1),
        }
        : {
          destNode: new DocumentFragment(),
          remainingNodes: nodes,
        };

      if (node.nodeType === Node.TEXT_NODE) {
        destNode.appendChild(node);

        return [...remainingNodes, destNode];
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return [...remainingNodes, destNode];
      }

      const elementNodeProcessingResult = this.processElementNode(node, remainingNodes, destNode);

      if (elementNodeProcessingResult) {
        return elementNodeProcessingResult;
      }

      const processedChildNodes = Array.from(node.childNodes).reduce(reducer, []);

      return [...remainingNodes, ...processedChildNodes];
    };

    return children.reduce(reducer, []);
  }
}
