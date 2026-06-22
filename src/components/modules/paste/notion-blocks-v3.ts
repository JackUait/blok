/**
 * Parser for Notion's proprietary lossless clipboard flavor
 * `text/_notion-blocks-v3-production`.
 *
 * When you copy blocks in Notion's web app, the clipboard carries — alongside
 * `text/plain` and `text/html` — a JSON "record-map" under this MIME type that
 * preserves EVERY block's state (checked, language, collapsed, icon, colour,
 * nesting…).  The HTML flavour cannot carry that state, so this JSON is the
 * high-fidelity migration source for Notion-web → Blok-web paste.
 *
 * IMPORTANT: this is Notion's INTERNAL record-map, NOT the public REST API.
 * Type names are internal (`text`, `header`, `sub_header`, `sub_sub_header`,
 * `to_do`, `bulleted_list`…), rich-text is nested flag-arrays (NOT
 * `annotations:{bold:true}`), and `checked` is `[["Yes"|"No"]]` (NOT boolean).
 * See docs/plans/2026-06-22-notion-paste-migration-design.md §0.1.
 *
 * The output is a flat array of {@link NotionParsedBlock} (the same
 * `{ id, tool, data, parentId }` shape the Blok clipboard handler consumes),
 * which the two-pass `BlokDataHandler.insertBlokBlocks` builder turns into a
 * correctly-nested block tree.
 */

import { colorVarName } from '../../shared/color-presets';
import { DEFAULT_EMOJI } from '../../../tools/callout/constants';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../tools/code/constants';
import { matchEmbedService } from '../../../tools/link/registry';

/** MIME flavour that carries Notion's lossless block record-map. */
export const NOTION_BLOCKS_V3_MIME = 'text/_notion-blocks-v3-production';

/**
 * A single Blok-ready block produced from the Notion record-map.
 * Shape-compatible with the clipboard handler's `BlokClipboardBlock`.
 */
export interface NotionParsedBlock {
  id: string;
  tool: string;
  data: Record<string, unknown>;
  parentId?: string | null;
}

/** A Notion record-map block `value` (loosely typed — fields are optional). */
interface NotionValue {
  id: string;
  type: string;
  content?: string[];
  properties?: Record<string, unknown>;
  format?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Result of mapping one Notion value: tool + data, or `null` to skip-promote. */
interface Mapped {
  tool: string;
  data: Record<string, unknown>;
}

/**
 * Parse the `text/_notion-blocks-v3-production` clipboard payload into a flat
 * array of Blok-ready blocks.  Returns `null` when the payload is not valid
 * JSON or does not look like the Notion record-map (so callers can fall back
 * to the HTML path).
 */
export function parseNotionBlocksV3(json: string): NotionParsedBlock[] | null {
  const parsed = safeJsonParse(json);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const blocks = (parsed as { blocks?: unknown }).blocks;

  if (!Array.isArray(blocks)) {
    return null;
  }

  // Merge every subtree's block map into one id → value lookup, and remember
  // the top-level (selected) order from the `blocks` array.
  const byId = new Map<string, NotionValue>();

  blocks.forEach((entry) => {
    const map = (entry as { blockSubtree?: { block?: Record<string, { value?: NotionValue }> } })
      ?.blockSubtree?.block;

    if (map === undefined || map === null) {
      return;
    }

    Object.keys(map).forEach((id) => {
      const value = map[id]?.value;

      if (value !== undefined && value !== null && typeof value === 'object') {
        byId.set(id, value);
      }
    });
  });

  // Require record-map structure: at least one resolvable block value.
  if (byId.size === 0) {
    return null;
  }

  const topLevelOrder = blocks
    .map((entry) => (entry as { blockId?: string })?.blockId)
    .filter((id): id is string => typeof id === 'string' && byId.has(id));

  const result: NotionParsedBlock[] = [];
  const visited = new Set<string>();

  /**
   * Depth-first emit in document order. `parentId` is the id of the nearest
   * EMITTED ancestor (null at the top), so skip-promoted wrappers (page/tab)
   * lift their children to the grandparent without leaving a dangling parent.
   */
  const walk = (id: string, parentId: string | null): void => {
    if (visited.has(id)) {
      return;
    }

    const value = byId.get(id);

    if (value === undefined) {
      return;
    }

    visited.add(id);

    // Tables expand into a grid block plus one paragraph block per cell, and
    // consume their `table_row` children — handle them before the leaf mapping.
    if (value.type === 'table') {
      expandTable(value, parentId, byId, visited, result);

      return;
    }

    const mapped = mapValue(value);
    const children = Array.isArray(value.content) ? value.content : [];

    if (mapped === null) {
      // Structural wrapper (page / tab): drop it, promote its children.
      children.forEach((childId) => walk(childId, parentId));

      return;
    }

    const block: NotionParsedBlock = { id, tool: mapped.tool, data: mapped.data };

    if (parentId !== null) {
      block.parentId = parentId;
    }

    result.push(block);

    children.forEach((childId) => walk(childId, id));
  };

  topLevelOrder.forEach((id) => walk(id, null));

  return result;
}

/**
 * Expand a Notion `table` into a Blok table block (a grid of cell references)
 * plus one paragraph block per cell — Blok stores cell content as child blocks
 * referenced by id, not inline.  The owning `table_row` children are marked
 * visited so the walker never emits them separately.
 */
function expandTable(
  table: NotionValue,
  parentId: string | null,
  byId: Map<string, NotionValue>,
  visited: Set<string>,
  result: NotionParsedBlock[]
): void {
  const tableId = table.id;
  const format = table.format ?? {};
  const rowIds = (Array.isArray(table.content) ? table.content : []).filter(
    (rowId): rowId is string => typeof rowId === 'string'
  );
  const columnOrder = resolveColumnOrder(format.table_block_column_order, rowIds, byId);
  const cells: NotionParsedBlock[] = [];
  const content: { blocks: string[] }[][] = rowIds.map((rowId) => {
    visited.add(rowId);

    const rowProperties = byId.get(rowId)?.properties ?? {};

    return columnOrder.map((columnId) => {
      const cellId = `${rowId}:${columnId}`;

      cells.push({ id: cellId, tool: 'paragraph', data: { text: richText(rowProperties[columnId]) }, parentId: tableId });

      return { blocks: [cellId] };
    });
  });

  const tableBlock: NotionParsedBlock = {
    id: tableId,
    tool: 'table',
    data: {
      withHeadings: format.table_block_row_header === true,
      withHeadingColumn: format.table_block_column_header === true,
      content,
    },
  };

  if (parentId !== null) {
    tableBlock.parentId = parentId;
  }

  result.push(tableBlock);
  cells.forEach((cell) => result.push(cell));
}

/**
 * The column id order for a table: the explicit `table_block_column_order`, or
 * (when absent) the property keys of the first populated row.
 */
function resolveColumnOrder(
  order: unknown,
  rowIds: string[],
  byId: Map<string, NotionValue>
): string[] {
  if (Array.isArray(order) && order.length > 0) {
    return order.filter((columnId): columnId is string => typeof columnId === 'string');
  }

  for (const rowId of rowIds) {
    const properties = byId.get(rowId)?.properties;
    const keys = properties === undefined || properties === null ? [] : Object.keys(properties);

    if (keys.length > 0) {
      return keys;
    }
  }

  return [];
}

/**
 * Map one Notion block value to a Blok tool + data, or `null` for structural
 * wrappers that should be dropped while their children are promoted.
 */
function mapValue(value: NotionValue): Mapped | null {
  const props = value.properties ?? {};
  const text = richText(props.title);

  switch (value.type) {
    case 'text':
      return { tool: 'paragraph', data: { text } };
    case 'header':
      return { tool: 'header', data: { text, level: 1 } };
    case 'sub_header':
      return { tool: 'header', data: { text, level: 2 } };
    case 'sub_sub_header':
      return { tool: 'header', data: { text, level: 3 } };
    case 'quote':
      return { tool: 'quote', data: { text } };
    case 'divider':
      return { tool: 'divider', data: {} };
    case 'code':
      return {
        tool: 'code',
        data: { code: plainText(props.title), language: mapLanguage(props.language), lineNumbers: false },
      };
    case 'to_do':
      return { tool: 'list', data: { text, style: 'checklist', checked: isChecked(props.checked) } };
    case 'bulleted_list':
      return { tool: 'list', data: { text, style: 'unordered' } };
    case 'numbered_list':
      return { tool: 'list', data: { text, style: 'ordered' } };
    case 'toggle':
      return { tool: 'toggle', data: { text, isOpen: true } };
    case 'column_list':
      return { tool: 'column_list', data: {} };
    case 'column': {
      const ratio = value.format?.column_ratio;

      return { tool: 'column', data: typeof ratio === 'number' && ratio !== 1 ? { widthRatio: ratio } : {} };
    }
    case 'table_row':
      // Consumed by `expandTable`; a stray row should never surface as a block.
      return null;
    case 'equation':
      return { tool: 'code', data: { code: plainText(props.title), language: 'latex', lineNumbers: false } };
    case 'bookmark':
      return mapBookmark(props, value.format ?? {}, text);
    case 'image':
      return mapMediaFile('image', props, value.format ?? {}, text);
    case 'file':
      return mapMediaFile('file', props, value.format ?? {}, text);
    case 'video':
      return mapVideo(props, value.format ?? {}, text);
    case 'drive':
      return mapDrive(props, value.format ?? {}, text);
    case 'callout': {
      const format = value.format ?? {};
      const emoji = typeof format.page_icon === 'string' && format.page_icon.length > 0 ? format.page_icon : DEFAULT_EMOJI;
      const { textColor, backgroundColor } = parseBlockColor(format.block_color);

      return { tool: 'callout', data: { emoji, text, textColor, backgroundColor } };
    }
    case 'page':
    case 'tab':
      // Document/tab wrappers — skip, promote children. (Sub-page references
      // are handled in a later phase.)
      return null;
    default:
      // Unmapped types (media, columns, tables, equation…) fall back to a
      // paragraph for now; later phases give each its own mapping.
      return { tool: 'paragraph', data: { text } };
  }
}

/** Parse JSON, returning `null` instead of throwing on malformed input. */
function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Map a Notion bookmark to the Blok bookmark tool (or a text fallback). */
function mapBookmark(
  props: Record<string, unknown>,
  format: Record<string, unknown>,
  text: string
): Mapped {
  const url = firstHttpUrl(props.link);

  if (url === null) {
    return { tool: 'paragraph', data: { text } };
  }

  const data: Record<string, unknown> = { url };
  const bookmarkTitle = plainText(props.title);
  const description = plainText(props.description);

  if (bookmarkTitle.length > 0) {
    data.title = bookmarkTitle;
  }

  if (description.length > 0) {
    data.description = description;
  }

  if (typeof format.bookmark_cover === 'string') {
    data.image = format.bookmark_cover;
  }

  if (typeof format.bookmark_icon === 'string') {
    data.favicon = format.bookmark_icon;
  }

  return { tool: 'bookmark', data };
}

/**
 * Map a Notion image/file to the Blok image/file tool when it has a usable
 * http(s) URL.  Notion-uploaded media uses `attachment:` refs that require auth
 * and carry no loadable URL, so those fall back to a filename paragraph.
 */
function mapMediaFile(
  tool: 'image' | 'file',
  props: Record<string, unknown>,
  format: Record<string, unknown>,
  text: string
): Mapped {
  const url = firstHttpUrl(props.source, format.display_source);

  if (url === null) {
    return { tool: 'paragraph', data: { text } };
  }

  if (tool === 'image') {
    return { tool: 'image', data: { url } };
  }

  const data: Record<string, unknown> = { url };
  const fileName = plainText(props.title);

  if (fileName.length > 0) {
    data.fileName = fileName;
  }

  return { tool: 'file', data };
}

/** Map a Notion video to an embed (provider match) or a direct video block. */
function mapVideo(props: Record<string, unknown>, format: Record<string, unknown>, text: string): Mapped {
  const url = firstHttpUrl(props.source, format.display_source);

  if (url === null) {
    return { tool: 'paragraph', data: { text } };
  }

  const embed = resolveEmbed(url);

  return embed ?? { tool: 'video', data: { url } };
}

/** Map a Notion drive embed to an embed (provider match) or a bookmark. */
function mapDrive(props: Record<string, unknown>, format: Record<string, unknown>, text: string): Mapped {
  const url = firstHttpUrl(props.source, format.display_source);

  if (url === null) {
    return { tool: 'paragraph', data: { text } };
  }

  return resolveEmbed(url) ?? { tool: 'bookmark', data: { url } };
}

/** Resolve a URL against the embed registry into Blok embed data, or `null`. */
function resolveEmbed(url: string): Mapped | null {
  const match = matchEmbedService(url);

  if (match === null) {
    return null;
  }

  return { tool: 'embed', data: { service: match.service, source: url, embed: match.embedUrl, kind: match.kind } };
}

/** First candidate that resolves to an http(s) URL (string or rich-text array). */
function firstHttpUrl(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const raw = typeof candidate === 'string' ? candidate : plainText(candidate);
    const trimmed = raw.trim();

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
  }

  return null;
}

/** Whether a Notion `checked` property (`[["Yes"|"No"]]`) is checked. */
function isChecked(checked: unknown): boolean {
  return Array.isArray(checked) && Array.isArray(checked[0]) && checked[0][0] === 'Yes';
}

/** Pre-built lower-cased display-name → language-id lookup for code blocks. */
const LANGUAGE_BY_NAME = new Map(LANGUAGES.map((l) => [l.name.toLowerCase(), l.id]));

/** Map a Notion `language` property (`[["JavaScript"]]`) to a Blok language id. */
function mapLanguage(language: unknown): string {
  if (!Array.isArray(language) || !Array.isArray(language[0]) || typeof language[0][0] !== 'string') {
    return DEFAULT_LANGUAGE;
  }

  return LANGUAGE_BY_NAME.get(language[0][0].toLowerCase()) ?? DEFAULT_LANGUAGE;
}

/** Concatenate a rich-text array into raw plain text (no escaping, no markup). */
function plainText(title: unknown): string {
  if (!Array.isArray(title)) {
    return '';
  }

  return title.map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
}

/** Convert a Notion rich-text array into Blok inline HTML. */
function richText(title: unknown): string {
  if (!Array.isArray(title)) {
    return '';
  }

  return title.map((seg) => segmentHtml(seg)).join('');
}

/** Convert one rich-text segment `[text, [[flag, …args], …]]` to HTML. */
function segmentHtml(segment: unknown): string {
  if (!Array.isArray(segment)) {
    return '';
  }

  const raw = typeof segment[0] === 'string' ? segment[0] : '';
  const annotations = Array.isArray(segment[1]) ? segment[1] : [];

  // Colour flags ('h') collapse into ONE <mark>; every other flag wraps inside it.
  const isColour = (a: unknown): boolean => Array.isArray(a) && a[0] === 'h';
  const inner = annotations
    .filter((a) => !isColour(a))
    .reduce<string>((html, annotation) => wrapMark(annotation, html), escapeHtml(raw));
  const style = buildColourStyle(annotations.filter(isColour));

  return style.length > 0 ? `<mark style="${style}">${inner}</mark>` : inner;
}

/** A parsed Notion colour token: a preset name applied as text or background. */
interface NotionColour {
  mode: 'text' | 'bg';
  name: string;
}

/**
 * Parse a Notion colour token (`orange`, `gray_background`, `default`) into a
 * preset name + mode, or `null` for the no-colour `default` token.
 */
function parseNotionColour(token: unknown): NotionColour | null {
  if (typeof token !== 'string' || token.length === 0 || token === 'default') {
    return null;
  }

  const suffix = '_background';
  const colour: NotionColour = token.endsWith(suffix)
    ? { mode: 'bg', name: token.slice(0, -suffix.length) }
    : { mode: 'text', name: token };

  // `default` / `default_background` mean "no tint" — surface as no colour.
  return colour.name === 'default' ? null : colour;
}

/** Build a `<mark>` style string from one or more Notion colour flags. */
function buildColourStyle(colourFlags: unknown[]): string {
  const colours = colourFlags
    .map((flag) => parseNotionColour(Array.isArray(flag) ? flag[1] : undefined))
    .filter((colour): colour is NotionColour => colour !== null);
  const text = colours.find((colour) => colour.mode === 'text');
  const background = colours.find((colour) => colour.mode === 'bg');
  const parts: string[] = [];

  if (text) {
    parts.push(`color: ${colorVarName(text.name, 'text')}`);
  }

  if (background) {
    parts.push(`background-color: ${colorVarName(background.name, 'bg')}`);
  }

  return parts.join('; ');
}

/** Map a Notion `block_color` to callout `{ textColor, backgroundColor }` names. */
function parseBlockColor(token: unknown): { textColor: string | null; backgroundColor: string | null } {
  const colour = parseNotionColour(token);

  if (colour === null) {
    return { textColor: null, backgroundColor: null };
  }

  return colour.mode === 'text'
    ? { textColor: colour.name, backgroundColor: null }
    : { textColor: null, backgroundColor: colour.name };
}

/** Wrap inner HTML with the Blok inline tag for a single Notion mark flag. */
function wrapMark(annotation: unknown, inner: string): string {
  if (!Array.isArray(annotation)) {
    return inner;
  }

  switch (annotation[0]) {
    case 'b':
      return `<b>${inner}</b>`;
    case 'i':
      return `<i>${inner}</i>`;
    case 's':
      return `<s>${inner}</s>`;
    case 'c':
      return `<code>${inner}</code>`;
    case '_':
      return `<u>${inner}</u>`;
    case 'a': {
      const href = safeHref(annotation[1]);

      return href === null ? inner : `<a href="${escapeAttr(href)}">${inner}</a>`;
    }
    default:
      // 'h' (colour), 'p' (page mention), 'e' (equation) — later phases.
      return inner;
  }
}

/**
 * Validate a link href against a scheme allow-list, returning the trimmed URL
 * or `null` for dangerous schemes (`javascript:`, `data:`, `vbscript:`…).
 * A malicious Notion clipboard payload could otherwise smuggle a script URI
 * into `data.text`, which the link tool's sanitizer preserves verbatim.
 */
function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();

  // http(s), mailto, tel, and relative/anchor links only.
  return /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(trimmed) ? trimmed : null;
}

/** Escape `&`, `<`, `>` for HTML text content. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a string for use inside a double-quoted HTML attribute. */
function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
