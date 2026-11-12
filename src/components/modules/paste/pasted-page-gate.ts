import type { BlockToolData } from '../../../../types';
import type { PageConfig } from '../../../tools/page/types';
import type { ClipboardBlockData } from '../../../shared/table/types';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK, mayHoldPageReference } from '../../../shared/page-reference';
import { parseUntrustedDocument, parseUntrustedHtml } from '../../utils/inert-html';

/**
 * Pasted content can be forged by any page, so a page id read from it is only
 * a claim. It stays a mention or page link when the page is already in this
 * document, or when the host's `resolve` finds it and grants access. Anything
 * else becomes plain text, or a plain link when it has an href.
 */

const POINTER_TOOLS = new Set(['page', 'page-link']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A rich text segment's page mention: `{ embed: { page: { id } } }`. */
const segmentPageId = (value: Record<string, unknown>): string | undefined => {
  const page = isRecord(value.embed) && isRecord(value.embed.page) ? value.embed.page : undefined;

  return typeof page?.id === 'string' && page.id !== '' ? page.id : undefined;
};

const referenceAnchors = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll(`a[${PAGE_REFERENCE_ATTR}]`)).filter((anchor) => anchor.getAttribute(PAGE_REFERENCE_ATTR));

/**
 * A page reference anchor that may not stay one: a plain link when it has an
 * href, else its own content.
 * @param anchor - an anchor in detached, pasted markup
 */
export const unlinkPageReference = (anchor: Element): void => {
  anchor.removeAttribute(PAGE_REFERENCE_ATTR);

  if (!anchor.hasAttribute('href')) {
    anchor.replaceWith(...Array.from(anchor.childNodes));
  }
};

/**
 * Every page id named in a value: mention anchors in html strings, mention
 * segments, and the `pageId` of a page or page link block.
 * @param value - block data, at any depth
 * @param ids - where the ids are added
 */
const collectIds = (value: unknown, ids: Set<string>): void => {
  if (typeof value === 'string') {
    if (mayHoldPageReference(value)) {
      referenceAnchors(parseUntrustedHtml(value)).forEach((anchor) => ids.add(anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? ''));
    }

    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));

    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const segmentId = segmentPageId(value);

  if (segmentId !== undefined) {
    ids.add(segmentId);
  }
  Object.values(value).forEach((item) => collectIds(item, ids));
};

/**
 * The value with every page mention the host did not confirm turned into text.
 * @param value - block data, at any depth
 * @param confirmed - the page ids that may stay
 */
const withoutUnconfirmed = (value: unknown, confirmed: ReadonlySet<string>): unknown => {
  if (typeof value === 'string') {
    if (!mayHoldPageReference(value)) {
      return value;
    }
    const wrapper = parseUntrustedHtml(value);
    const denied = referenceAnchors(wrapper).filter((anchor) => !confirmed.has(anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? ''));

    if (denied.length === 0) {
      return value;
    }
    denied.forEach(unlinkPageReference);

    return wrapper.innerHTML;
  }
  if (Array.isArray(value)) {
    return value.map((item) => withoutUnconfirmed(item, confirmed));
  }
  if (!isRecord(value)) {
    return value;
  }

  const segmentId = segmentPageId(value);

  if (segmentId !== undefined && !confirmed.has(segmentId)) {
    const { embed: _embed, ...marks } = value;

    return { ...marks, text: PAGE_REFERENCE_FALLBACK };
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutUnconfirmed(item, confirmed)]));
};

/** A pasted block, as the clipboard and the converters shape it. */
export interface PastedBlockShape {
  tool: string;
  data: BlockToolData;
}

/**
 * The page a pasted page or page link block points at, looking through a stub.
 * @param block - the pasted block
 * @param stubTool - the name of the stub tool
 */
export const pastedPointerId = (block: PastedBlockShape, stubTool: string): string | undefined => {
  const saved: unknown = block.tool === stubTool ? (block.data as { savedData?: unknown }).savedData : block;
  const type = isRecord(saved) ? saved.type ?? saved.tool : undefined;
  const data = isRecord(saved) ? saved.data : undefined;
  const pageId = isRecord(data) ? data.pageId : undefined;

  return typeof type === 'string' && POINTER_TOOLS.has(type) && typeof pageId === 'string' && pageId !== '' ? pageId : undefined;
};

/**
 * Every page id named by pasted blocks.
 * @param blocks - the pasted blocks
 * @param stubTool - the name of the stub tool
 */
export const pastedPageIds = (blocks: readonly PastedBlockShape[], stubTool: string): Set<string> => {
  const ids = new Set<string>();

  blocks.forEach((block) => {
    const pointer = pastedPointerId(block, stubTool);

    if (pointer !== undefined) {
      ids.add(pointer);
    }
    collectIds(block.data, ids);
  });
  ids.delete('');

  return ids;
};

/**
 * Pasted block data with every page mention the host did not confirm turned into text.
 * @param data - the block data
 * @param confirmed - the page ids that may stay
 */
export const dataWithoutUnconfirmedPages = (data: BlockToolData, confirmed: ReadonlySet<string>): BlockToolData =>
  withoutUnconfirmed(data, confirmed) as BlockToolData;

/**
 * Page ids pasted html names in mention anchors.
 * @param root - the detached, pasted markup
 */
export const pageReferenceIds = (root: ParentNode): Set<string> =>
  new Set(referenceAnchors(root).map((anchor) => anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? ''));

/**
 * Page ids this document already holds: page and page link blocks, and mentions.
 * @param Blok - the editor's modules
 */
const livePageIds = (Blok: BlokModules): Set<string> => {
  const ids = new Set<string>();

  Blok.BlockManager.blocks
    .filter((block) => POINTER_TOOLS.has(block.name))
    .forEach((block) => {
      const pageId: unknown = block.preservedData.pageId;

      if (typeof pageId === 'string') {
        ids.add(pageId);
      }
    });
  pageReferenceIds(Blok.UI.nodes.wrapper).forEach((pageId) => ids.add(pageId));

  return ids;
};

/**
 * The pasted page ids that may stay mentions or page links: those already in
 * this document, and those the host's `resolve` finds and grants. Without
 * `resolve`, only the first. One host call per id.
 * @param page - the page tool's config
 * @param live - the page ids already in this document
 * @param ids - the pasted page ids
 */
export const confirmPageIds = async (
  page: PageConfig | undefined,
  live: ReadonlySet<string>,
  ids: ReadonlySet<string>
): Promise<Set<string>> => {
  const unknown = [...ids].filter((pageId) => !live.has(pageId));
  const granted = await Promise.all(unknown.map((pageId) => Promise.resolve()
    .then(() => page?.resolve?.(pageId))
    .then((info) => (info !== null && info !== undefined && info.access !== 'none' ? pageId : undefined))
    .catch((): undefined => undefined)));

  const allowed = new Set(granted);

  return new Set([...ids].filter((pageId) => live.has(pageId) || allowed.has(pageId)));
};

/**
 * {@link confirmPageIds} for this editor.
 * @param Blok - the editor's modules
 * @param ids - the pasted page ids
 */
export const confirmPastedPageIds = (Blok: BlokModules, ids: ReadonlySet<string>): Promise<Set<string>> =>
  confirmPageIds(Blok.Tools.blockTools.get('page')?.settings, livePageIds(Blok), ids);

/**
 * The blocks and all their nested children, in order.
 * @param blocks - clipboard cell blocks
 */
export const withChildren = (blocks: readonly ClipboardBlockData[]): ClipboardBlockData[] =>
  blocks.flatMap((block) => [block, ...withChildren(block.children ?? [])]);

/**
 * A table cell block with every page the host did not confirm as text.
 * @param block - a clipboard cell block
 * @param confirmed - the page ids that may stay
 * @param stubTool - the name of the stub tool
 */
export const cellBlockWithoutUnconfirmedPages = (block: ClipboardBlockData, confirmed: ReadonlySet<string>, stubTool: string): ClipboardBlockData => {
  const pointer = pastedPointerId(block, stubTool);

  if (pointer !== undefined && !confirmed.has(pointer)) {
    return { tool: 'paragraph', data: { text: PAGE_REFERENCE_FALLBACK } };
  }

  return {
    ...block,
    data: dataWithoutUnconfirmedPages(block.data, confirmed),
    ...(block.children === undefined ? {} : { children: block.children.map((child) => cellBlockWithoutUnconfirmedPages(child, confirmed, stubTool)) }),
  };
};

/**
 * Clipboard html with every page mention the host did not confirm turned into
 * text, or a link when it has an href. It runs before the first sanitize pass,
 * which replaces a mention's text with a neutral one.
 * @param Blok - the editor's modules
 * @param html - the text/html flavour
 * @returns the same string when every mention may stay
 */
export const htmlWithConfirmedPageReferences = async (Blok: BlokModules, html: string): Promise<string> => {
  if (!mayHoldPageReference(html)) {
    return html;
  }
  // A whole document: Excel's <style> in <head> must survive for the pre-passes.
  const doc = parseUntrustedDocument(html);
  const ids = pageReferenceIds(doc);

  if (ids.size === 0) {
    return html;
  }
  const confirmed = await confirmPastedPageIds(Blok, ids);
  const denied = referenceAnchors(doc).filter((anchor) => !confirmed.has(anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? ''));

  if (denied.length === 0) {
    return html;
  }
  denied.forEach(unlinkPageReference);

  return doc.documentElement.outerHTML;
};
