/**
 * Parser for buildin.ai's proprietary lossless clipboard flavours
 * `text/next-space-blocks` (multi-block copy) and `text/next-space-content`
 * (single-block copy).
 *
 * When you copy blocks in buildin.ai's web app, the clipboard carries — beside
 * `text/plain` and `text/html` — a JSON envelope under these MIME types that
 * preserves EVERY block's state (type, level, checked, language, icon, colour,
 * nesting…). The HTML flavour cannot carry all of that, so this JSON is the
 * high-fidelity migration source for buildin-web → Blok-web paste, mirroring
 * what {@link parseNotionBlocksV3} does for Notion.
 *
 * Envelope: `{ blocks: [{ id, subTree: { <uuid>: node } }], pageId, fromType }`.
 * The `blocks` array is ALREADY in document order; every top-level root points
 * its `parentId` at `pageId` (itself absent from the payload, so roots have no
 * emitted parent). `node.subNodes` is the ordered child-uuid array. A node's
 * type is a NUMBER and its text is the concatenation of `data.segments[*].text`.
 *
 * The output is a flat array of {@link NextSpaceParsedBlock} (the same
 * `{ id, tool, data, parentId }` shape the Blok clipboard handler consumes),
 * which the two-pass `BlokDataHandler` builder turns into a nested block tree.
 */

import { COLOR_PRESETS } from '../../shared/color-presets';
import { DEFAULT_EMOJI } from '../../../tools/callout/constants';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../tools/code/constants';
import { matchEmbedService } from '../../../tools/link/registry';

// NOTE: notion-blocks-v3 also uses `colorVarName` for its inline <mark> colour
// styling. buildin's captured clipboard carries no inline colour marks (every
// enhancer is `{}`), so the plain-text mapping does not need it — wire it in
// alongside the TODO(inline-marks) work in `segmentsToHtml` once formatted
// content is captured. (Block-level callout colours ARE handled, via
// `normalizeBuildinColor` below.)

/** MIME flavours that carry buildin.ai's lossless block envelope. */
export const NEXT_SPACE_MIMES = ['text/next-space-blocks', 'text/next-space-content'];

/**
 * A single Blok-ready block produced from the buildin envelope.
 * Shape-compatible with the clipboard handler's `BlokClipboardBlock`.
 */
export interface NextSpaceParsedBlock {
  id: string;
  tool: string;
  data: Record<string, unknown>;
  parentId?: string | null;
}

/** A buildin block node (loosely typed — most fields are optional). */
interface NextSpaceNode {
  uuid: string;
  type: number;
  title?: string;
  backgroundColor?: string;
  textColor?: string;
  data?: Record<string, unknown>;
  subNodes?: string[];
  [key: string]: unknown;
}

/** Result of mapping one node: tool + data. */
interface Mapped {
  tool: string;
  data: Record<string, unknown>;
}

/**
 * Parse a `text/next-space-blocks` / `text/next-space-content` payload into a
 * flat array of Blok-ready blocks. Returns `null` when the payload is not valid
 * JSON or does not look like the buildin envelope (so callers fall back to the
 * HTML path).
 */
export function parseNextSpaceBlocks(json: string): NextSpaceParsedBlock[] | null {
  const parsed = safeJsonParse(json);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const envelope = decodeEnvelope(parsed as Record<string, unknown>);

  if (envelope === null) {
    return null;
  }

  const { byId, topLevelOrder } = envelope;
  const result: NextSpaceParsedBlock[] = [];
  const visited = new Set<string>();

  /**
   * Depth-first emit in document order. `parentId` is the uuid of the nearest
   * EMITTED ancestor (null at the top).
   */
  const walk = (id: string, parentId: string | null): void => {
    if (visited.has(id)) {
      return;
    }

    const node = byId.get(id);

    if (node === undefined) {
      return;
    }

    visited.add(id);

    // Tables expand into a grid block plus one paragraph block per cell, and
    // consume their `type 28` row children — handle them before the leaf map.
    if (node.type === 27) {
      expandTable(node, parentId, byId, visited, result);

      return;
    }

    const mapped = mapNode(node);

    if (mapped === null) {
      // Type-28 table rows are consumed by `expandTable`; a stray one is a no-op.
      return;
    }

    const block: NextSpaceParsedBlock = { id, tool: mapped.tool, data: mapped.data };

    if (parentId !== null) {
      block.parentId = parentId;
    }

    result.push(block);

    // Blok's callout keeps its body in CHILD blocks (CalloutData has no `text`
    // field), so the callout's inline text — which buildin stores on the callout
    // node itself — becomes a child paragraph, matching what a native callout
    // copy carries. (Any `subNodes` are appended after it below.)
    if (node.type === 13) {
      const body = segmentsToHtml((node.data ?? {}).segments);

      if (body.length > 0) {
        result.push({ id: `${id}:callout-body`, tool: 'paragraph', data: { text: body }, parentId: id });
      }
    }

    const children = Array.isArray(node.subNodes) ? node.subNodes : [];

    children.forEach((childId) => walk(childId, id));
  };

  topLevelOrder.forEach((id) => walk(id, null));

  return result;
}

/**
 * Decode a buildin clipboard payload into a uuid → node lookup plus the
 * top-level document order, or `null` when no buildin nodes are present.
 *
 * Two envelope shapes are accepted:
 *  - `text/next-space-blocks` (multi-block copy): `{ blocks: [{ id, subTree }] }`
 *    — order comes from the `blocks` array.
 *  - `text/next-space-content` (single-block copy): the `blocks` wrapper is
 *    absent, so nodes are read from `subTree`, a bare node, or a raw node-map,
 *    and every node whose parent is outside the copied set is a top-level root.
 */
function decodeEnvelope(parsed: Record<string, unknown>): { byId: Map<string, NextSpaceNode>; topLevelOrder: string[] } | null {
  const byId = new Map<string, NextSpaceNode>();
  const blocks = (parsed as { blocks?: unknown }).blocks;

  if (Array.isArray(blocks) && blocks.length > 0) {
    blocks.forEach((entry) => indexNodes((entry as { subTree?: unknown })?.subTree, byId));

    if (byId.size === 0) {
      return null;
    }

    const topLevelOrder = blocks
      .map((entry) => (entry as { id?: string })?.id)
      .filter((id): id is string => typeof id === 'string');

    return { byId, topLevelOrder };
  }

  const subTree = (parsed as { subTree?: unknown }).subTree;

  if (subTree !== undefined) {
    indexNodes(subTree, byId);
  } else if (isNextSpaceNode(parsed)) {
    byId.set(parsed.uuid, parsed);
  } else {
    indexNodes(parsed, byId);
  }

  if (byId.size === 0) {
    return null;
  }

  const topLevelOrder = [...byId.values()]
    .filter((node) => {
      const parentId = (node as { parentId?: unknown }).parentId;

      return typeof parentId !== 'string' || !byId.has(parentId);
    })
    .map((node) => node.uuid);

  return { byId, topLevelOrder };
}

/**
 * Expand a buildin `table` (type 27) into a Blok table block (a grid of cell
 * references) plus one paragraph block per cell — Blok stores cell content as
 * child blocks referenced by id, not inline. The owning row nodes (type 28) are
 * marked visited so the walker never emits them separately.
 */
function expandTable(
  table: NextSpaceNode,
  parentId: string | null,
  byId: Map<string, NextSpaceNode>,
  visited: Set<string>,
  result: NextSpaceParsedBlock[]
): void {
  const tableId = table.uuid;
  const data = table.data ?? {};
  const format = isPlainObject(data.format) ? data.format : {};
  const rowIds = (Array.isArray(table.subNodes) ? table.subNodes : []).filter(
    (rowId): rowId is string => typeof rowId === 'string'
  );
  const columnOrder = Array.isArray(format.tableBlockColumnOrder)
    ? format.tableBlockColumnOrder.filter((columnId): columnId is string => typeof columnId === 'string')
    : [];
  const cells: NextSpaceParsedBlock[] = [];
  const content: { blocks: string[] }[][] = rowIds.map((rowId) => {
    visited.add(rowId);

    const rowData = byId.get(rowId)?.data ?? {};
    const collectionProperties = isPlainObject(rowData.collectionProperties) ? rowData.collectionProperties : {};

    return columnOrder.map((columnId) => {
      const cellId = `${rowId}:${columnId}`;

      cells.push({ id: cellId, tool: 'paragraph', data: { text: segmentsToHtml(collectionProperties[columnId]) }, parentId: tableId });

      return { blocks: [cellId] };
    });
  });

  const tableBlock: NextSpaceParsedBlock = {
    id: tableId,
    tool: 'table',
    data: {
      withHeadings: format.tableBlockRowHeader === true,
      withHeadingColumn: format.tableBlockColumnHeader === true,
      content,
    },
  };

  if (parentId !== null) {
    tableBlock.parentId = parentId;
  }

  result.push(tableBlock);
  cells.forEach((cell) => result.push(cell));
}

/** Map one buildin node to a Blok tool + data, or `null` to skip (table rows). */
function mapNode(node: NextSpaceNode): Mapped | null {
  const data = node.data ?? {};
  const text = segmentsToHtml(data.segments);

  switch (node.type) {
    case 1:
      return { tool: 'paragraph', data: { text } };
    case 3:
      return { tool: 'list', data: { text, style: 'checklist', checked: data.checked === true } };
    case 4:
      return { tool: 'list', data: { text, style: 'unordered' } };
    case 5:
      return { tool: 'list', data: { text, style: 'ordered' } };
    case 7:
      return { tool: 'header', data: { text, level: data.level } };
    case 38:
      return { tool: 'header', data: { text, level: data.level, isToggleable: true, isOpen: true } };
    case 6:
      return { tool: 'toggle', data: { text, isOpen: true } };
    case 9:
      return { tool: 'divider', data: {} };
    case 12:
      return { tool: 'quote', data: { text } };
    case 13:
      return mapCallout(node, data);
    case 25:
      return {
        tool: 'code',
        data: { code: plainText(data.segments), language: mapLanguageName(languageOf(data.format)), lineNumbers: false },
      };
    case 23:
      return { tool: 'code', data: { code: plainText(data.segments), language: 'latex', lineNumbers: false } };
    case 10:
      return { tool: 'column_list', data: {} };
    case 11: {
      const ratio = data.columnRatio;

      return { tool: 'column', data: typeof ratio === 'number' && ratio !== 1 ? { widthRatio: ratio } : {} };
    }
    case 14:
      return mapMedia(node, data, text);
    case 21:
      return mapEmbedOrBookmark(data, text);
    case 28:
      // Consumed by `expandTable`; a stray row should never surface as a block.
      return null;
    default:
      // Unmapped types fall back to a paragraph carrying their text.
      return { tool: 'paragraph', data: { text } };
  }
}

/**
 * Map a buildin callout (type 13) to callout DATA only — colour names live on
 * the node (not `data`). The body text is emitted SEPARATELY as a child
 * paragraph by the walker (Blok callouts store their body as child blocks), so
 * no `text` field is emitted here (the callout tool would silently discard it).
 */
function mapCallout(node: NextSpaceNode, data: Record<string, unknown>): Mapped {
  const icon = isPlainObject(data.icon) ? data.icon : {};
  const emoji = typeof icon.value === 'string' && icon.value.length > 0 ? icon.value : DEFAULT_EMOJI;

  return {
    tool: 'callout',
    data: { emoji, textColor: normalizeBuildinColor(node.textColor), backgroundColor: normalizeBuildinColor(node.backgroundColor) },
  };
}

/** The set of colour preset names Blok recognises (its callout/marker palette). */
const BLOK_COLOR_NAMES = new Set(COLOR_PRESETS.map((preset) => preset.name));

/**
 * Map a buildin colour NAME to a valid Blok preset name, or `null`. buildin uses
 * British `grey`; Blok's preset is American `gray` — passing `grey` through
 * verbatim yields an undefined `var(--blok-color-grey-bg)` that silently drops
 * the colour (and the callout's border). Names outside Blok's palette collapse
 * to `null` rather than render broken.
 */
function normalizeBuildinColor(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const name = value.toLowerCase() === 'grey' ? 'gray' : value.toLowerCase();

  return BLOK_COLOR_NAMES.has(name) ? name : null;
}

/** The `language` string from a code block's `data.format`, or `undefined`. */
function languageOf(format: unknown): unknown {
  return isPlainObject(format) ? format.language : undefined;
}

/**
 * Map a buildin media node (type 14) to image / video / audio / file by its
 * `data.display` discriminator. The binary lives behind buildin's signed CDN —
 * see {@link cdnUrl} — so the URL is best-effort.
 */
function mapMedia(node: NextSpaceNode, data: Record<string, unknown>, text: string): Mapped {
  const ossName = typeof data.ossName === 'string' ? data.ossName : '';
  const title = typeof node.title === 'string' ? node.title : '';
  const fileName = text.length > 0 ? text : title;

  if (ossName.length === 0) {
    // No CDN object — keep the filename as a paragraph rather than drop it.
    return { tool: 'paragraph', data: { text: fileName } };
  }

  const url = cdnUrl(ossName);
  const display = typeof data.display === 'string' ? data.display : 'file';

  if (display === 'image') {
    const imageData: Record<string, unknown> = { url };
    const alignment = gravityAlignment(data.format);

    if (alignment !== null) {
      imageData.alignment = alignment;
    }

    return { tool: 'image', data: imageData };
  }

  if (display === 'video') {
    return { tool: 'video', data: { url } };
  }

  if (display === 'audio') {
    const audioData: Record<string, unknown> = { url };

    if (fileName.length > 0) {
      audioData.title = fileName;
      audioData.fileName = fileName;
    }

    return { tool: 'audio', data: audioData };
  }

  // 'file' and any unknown display.
  const fileData: Record<string, unknown> = { url };

  if (fileName.length > 0) {
    fileData.fileName = fileName;
  }

  return { tool: 'file', data: fileData };
}

/**
 * Best-effort CDN URL for a buildin object. NOTE: the CDN signing token is NOT
 * present in the clipboard JSON, so this unsigned URL may not load directly;
 * faithful re-hosting of buildin media is a follow-up.
 */
function cdnUrl(ossName: string): string {
  return `https://cdn2.buildin.ai/${ossName}`;
}

/** Map a buildin `data.format.contentGravity` to a left/right image alignment. */
function gravityAlignment(format: unknown): 'left' | 'right' | null {
  if (!isPlainObject(format)) {
    return null;
  }

  if (format.contentGravity === 'LEFT') {
    return 'left';
  }

  if (format.contentGravity === 'RIGHT') {
    return 'right';
  }

  return null;
}

/**
 * Map a buildin embed/bookmark node (type 21) to a resolved embed (provider
 * match), a bookmark carrying the live URL, or a text fallback.
 */
function mapEmbedOrBookmark(data: Record<string, unknown>, text: string): Mapped {
  const url = firstHttpUrl(data.link);

  if (url === null) {
    return { tool: 'paragraph', data: { text } };
  }

  const embed = resolveEmbed(url);

  if (embed !== null) {
    return embed;
  }

  const bookmark: Record<string, unknown> = { url };
  const title = plainText(data.linkInfo);

  if (title.length > 0) {
    bookmark.title = title;
  }

  return { tool: 'bookmark', data: bookmark };
}

/** Resolve a URL against the embed registry into Blok embed data, or `null`. */
function resolveEmbed(url: string): Mapped | null {
  const match = matchEmbedService(url);

  if (match === null) {
    return null;
  }

  return { tool: 'embed', data: { service: match.service, source: url, embed: match.embedUrl, kind: match.kind } };
}

/** Pre-built lower-cased language-name → language-id lookup for code blocks. */
const LANGUAGE_BY_NAME = new Map(LANGUAGES.map((l) => [l.name.toLowerCase(), l.id]));

/** Map a buildin language name (e.g. "YAML") to a Blok language id. */
function mapLanguageName(name: unknown): string {
  return LANGUAGE_BY_NAME.get(String(name).toLowerCase()) ?? DEFAULT_LANGUAGE;
}

/** Parse JSON, returning `null` instead of throwing on malformed input. */
function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Convert a buildin `segments` array into Blok inline HTML.
 *
 * The captured fixture has NO inline formatting — every `segment.enhancer` is
 * `{}` — so this currently joins the HTML-escaped `text` of each segment, which
 * is correct and lossless for plain text.
 *
 * Soft line breaks (Shift+Enter) are carried as literal `\n` characters in the
 * segment text. A raw newline collapses to a single space when assigned as
 * innerHTML, so each is converted to a `<br>` — otherwise multi-line text
 * flattens onto one line on paste. (Code blocks keep their real newlines: they
 * read segment text via {@link plainText}, not this function.)
 *
 * EXTENSION POINT: inline marks (bold / italic / link / colour) live in
 * `segment.enhancer`; to render them, branch here on the enhancer's keys and
 * wrap the escaped text accordingly (mirroring notion-blocks-v3's `segmentHtml`).
 * TODO(inline-marks): the enhancer key vocabulary is unknown until a FORMATTED
 * buildin clipboard is captured — do NOT guess the key names.
 */
function segmentsToHtml(segments: unknown): string {
  if (!Array.isArray(segments)) {
    return '';
  }

  return newlinesToBr(
    segments
      .map((segment) => (isPlainObject(segment) && typeof segment.text === 'string' ? escapeHtml(segment.text) : ''))
      .join('')
  );
}

/**
 * Replace literal line breaks (`\n`, `\r\n`, `\r`) with `<br>`. Run AFTER HTML
 * escaping so the inserted tags are not themselves escaped.
 */
function newlinesToBr(html: string): string {
  return html.replace(/\r\n?|\n/g, '<br>');
}

/** Concatenate a buildin `segments` array into raw plain text (no escaping). */
function plainText(segments: unknown): string {
  if (!Array.isArray(segments)) {
    return '';
  }

  return segments
    .map((segment) => (isPlainObject(segment) && typeof segment.text === 'string' ? segment.text : ''))
    .join('');
}

/** First candidate that resolves to an http(s) URL. */
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

/** Whether a value is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is a buildin block node (the minimal `{ uuid, type }` shape). */
function isNextSpaceNode(value: unknown): value is NextSpaceNode {
  return isPlainObject(value) && typeof value.uuid === 'string' && typeof value.type === 'number';
}

/** Add every buildin node found among a map's values to `byId`. */
function indexNodes(map: unknown, byId: Map<string, NextSpaceNode>): void {
  if (!isPlainObject(map)) {
    return;
  }

  Object.values(map).forEach((value) => {
    if (isNextSpaceNode(value)) {
      byId.set(value.uuid, value);
    }
  });
}

/** Escape `&`, `<`, `>` for HTML text content. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
