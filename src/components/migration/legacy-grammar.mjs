/**
 * Editor.js → Blok legacy migration grammar (single source of truth).
 *
 * This is the ONE authoritative description of how each legacy Editor.js block
 * shape maps to Blok's hierarchical flat-with-references model. It is authored
 * in zero-dependency ESM so it can be consumed unchanged by BOTH:
 *
 *   - the ESM runtime (`src/components/utils/data-model-transform.ts`), which
 *     imports it and drives it with nanoid ids + `console.warn`, and
 *   - the standalone zero-dep codemod (`codemod/migrate-editorjs-to-blok.js`),
 *     which loads it via `require(esm)` (native on Node >= 20.19, the package's
 *     engines floor) and drives it with locally-minted ids + no warnings.
 *
 * It MUST stay ESM: the published package ships `src/`, and a consumer's dev
 * server (e.g. Vite serving a linked copy) loads this file with NO CommonJS
 * interop — a `.cjs` grammar evaluates there with zero exports and every named
 * import throws (see test/unit/architecture/esm-source-no-cjs-imports-law.test.ts).
 *
 * Because both consumers run the SAME `expandLegacyBlocks` code path over the
 * SAME `LEGACY_GRAMMAR` table, the two migration surfaces cannot drift: adding
 * or fixing a mapping in one place changes it everywhere at once.
 *
 * Environment concerns (how to mint a block id, whether/how to warn about a
 * dropped field) are injected via `ctx` so every `expand()` stays a pure
 * function of `(block, ctx)`:
 *
 *   ctx = {
 *     generateId(): string,                      // mint a fresh block id
 *     warn(blockType, field, verb): void,        // report a lossy field
 *   }
 *
 * Every `expand()` returns an ARRAY (a 1:1 mapping returns a single-element
 * array), so the interpreter can unconditionally spread the result — there is
 * no 1:1-vs-1:N branch to get wrong.
 */

// ---------------------------------------------------------------------------
// Block id generation (single source; the codemod imports these instead of
// keeping its own copy, and the runtime supplies nanoid via ctx.generateId).
// ---------------------------------------------------------------------------

// nanoid-compatible alphabet (URL-safe), matching the runtime's nanoid() ids.
const BLOCK_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const BLOCK_ID_LENGTH = 10;

/**
 * Create a nanoid-compatible id generator (A-Z, a-z, 0-9, _, -). Used by the
 * codemod, which has no nanoid dependency; the runtime injects its own nanoid
 * generator instead. Mirrors the runtime id shape so statically-migrated JSON
 * carries ids in the same form the runtime emits.
 * @returns {() => string} a generator producing 10-char ids
 */
function createBlockIdGenerator() {
  return function generateBlockId() {
    let id = '';

    for (let i = 0; i < BLOCK_ID_LENGTH; i++) {
      id += BLOCK_ID_ALPHABET[Math.floor(Math.random() * BLOCK_ID_ALPHABET.length)];
    }

    return id;
  };
}

// ---------------------------------------------------------------------------
// Callout variant ↔ backgroundColor preset maps (shared by both directions)
// ---------------------------------------------------------------------------

const VARIANT_TO_BG_PRESET = {
  general: null,
  note: 'blue',
  important: 'purple',
  warning: 'orange',
  additional: 'yellow',
  recommendation: 'green',
  caution: 'red',
};

const CALLOUT_DEFAULT_EMOJI = '💡';
const WARNING_EMOJI = '⚠️';

// ---------------------------------------------------------------------------
// Small shared predicates
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDefinedField(data, key) {
  if (!isPlainObject(data)) {
    return false;
  }

  return data[key] !== undefined;
}

function isOldChecklistItem(item) {
  return typeof item === 'object' && item !== null && 'text' in item && !('content' in item);
}

function normalizeListItem(item) {
  if (typeof item === 'string') {
    return { content: item };
  }

  if (isOldChecklistItem(item)) {
    return { content: item.text, checked: item.checked };
  }

  // @editorjs/list v2 (nested-list) moved per-item state under `meta`:
  // `{ content, meta: { checked }, items }`. Lift it back to the flat field the
  // rest of the grammar reads, so v1 and v2 dialects share one code path.
  if (isPlainObject(item) && item.checked === undefined && isPlainObject(item.meta) && item.meta.checked !== undefined) {
    return { ...item, checked: item.meta.checked };
  }

  return item;
}

function hasNestedListItems(items) {
  return items.some((item) => {
    const normalized = normalizeListItem(item);

    return normalized.items !== undefined && normalized.items.length > 0;
  });
}

function isLegacyListData(data) {
  return isPlainObject(data) && 'style' in data && 'items' in data && Array.isArray(data.items);
}

function getTableContentRows(data) {
  if (!isPlainObject(data)) {
    return null;
  }
  const content = data.content;

  if (!Array.isArray(content)) {
    return null;
  }

  return content;
}

function isCellWithBlockRefs(cell) {
  return typeof cell === 'object' && cell !== null && Array.isArray(cell.blocks);
}

/** Whether a legacy container block (toggleList/callout) carries body blocks. */
function hasLegacyBody(block) {
  const body = block.data && block.data.body;

  return Boolean(body && Array.isArray(body.blocks) && body.blocks.length > 0);
}

// ---------------------------------------------------------------------------
// Detection predicates (one per legacy type). Ported verbatim from the runtime
// isLegacy*Block guards so detection is identical to the pre-grammar behavior.
// ---------------------------------------------------------------------------

function detectList(block) {
  return block.type === 'list' && isLegacyListData(block.data);
}

function detectChecklist(block) {
  return (
    block.type === 'checklist' &&
    isPlainObject(block.data) &&
    Array.isArray(block.data.items)
  );
}

function detectLinkTool(block) {
  return (
    block.type === 'linkTool' &&
    isPlainObject(block.data) &&
    typeof block.data.link === 'string'
  );
}

function detectToggleList(block) {
  return block.type === 'toggleList' && isPlainObject(block.data) && 'title' in block.data;
}

function detectCallout(block) {
  return block.type === 'callout' && isPlainObject(block.data) && 'body' in block.data;
}

function detectImage(block) {
  if (block.type !== 'image' || !isPlainObject(block.data)) {
    return false;
  }

  const file = block.data.file;

  if (isPlainObject(file) && typeof file.url === 'string') {
    return true;
  }

  // @editorjs/simple-image: flat top-level url + at least one editor.js-only flag.
  const hasFlatUrl = typeof block.data.url === 'string';
  const hasLegacyFlag = 'withBorder' in block.data || 'withBackground' in block.data || 'stretched' in block.data;

  return hasFlatUrl && hasLegacyFlag;
}

function detectQuote(block) {
  return block.type === 'quote' && (hasDefinedField(block.data, 'caption') || hasDefinedField(block.data, 'alignment'));
}

function detectTable(block) {
  if (block.type !== 'table') {
    return false;
  }

  const rows = getTableContentRows(block.data);

  if (rows === null) {
    return false;
  }

  return rows.some((row) => Array.isArray(row) && row.some((cell) => typeof cell === 'string'));
}

function detectRaw(block) {
  return block.type === 'raw' && hasDefinedField(block.data, 'html');
}

function detectWarning(block) {
  return block.type === 'warning' && isPlainObject(block.data);
}

function detectAttaches(block) {
  if (block.type !== 'attaches' || !isPlainObject(block.data)) {
    return false;
  }

  const file = block.data.file;

  return isPlainObject(file) && typeof file.url === 'string';
}

// ---------------------------------------------------------------------------
// List expansion (shared by list + checklist)
// ---------------------------------------------------------------------------

function expandListItems(items, parentId, depth, style, start, tunes, blocks, ctx) {
  const childIds = [];

  items.forEach((rawItem, index) => {
    const item = normalizeListItem(rawItem);
    const itemId = ctx.generateId();

    childIds.push(itemId);

    const includeStart = style === 'ordered' && depth === 0 && index === 0 && start !== undefined && start !== 1;
    const hasChildren = item.items && item.items.length > 0;

    const itemBlock = {
      id: itemId,
      type: 'list',
      data: {
        text: item.content,
        checked: item.checked,
        style,
        ...(depth > 0 ? { depth } : {}),
        ...(includeStart ? { start } : {}),
      },
      ...(tunes !== undefined ? { tunes } : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
    };

    blocks.push(itemBlock);

    if (!hasChildren || !item.items) {
      return;
    }

    const nestedChildIds = expandListItems(item.items, itemId, depth + 1, style, undefined, tunes, blocks, ctx);

    if (nestedChildIds.length > 0) {
      itemBlock.content = nestedChildIds;
    }
  });

  return childIds;
}

/**
 * Read the ordered-list start across both Editor.js list dialects: v1 stores it
 * flat (`data.start`), v2 (nested-list) under `data.meta.start`.
 */
function readListStart(listData) {
  if (listData.start !== undefined) {
    return listData.start;
  }

  return isPlainObject(listData.meta) ? listData.meta.start : undefined;
}

function expandList(listData, tunes, ctx) {
  const blocks = [];

  if (isPlainObject(listData.meta) && listData.meta.counterType !== undefined) {
    // Blok's ordered lists always use decimal markers.
    ctx.warn('list', 'meta.counterType', 'dropped');
  }

  expandListItems(listData.items, undefined, 0, listData.style, readListStart(listData), tunes, blocks, ctx);

  return blocks;
}

// ---------------------------------------------------------------------------
// Legacy container body expansion (shared by toggleList + callout)
// ---------------------------------------------------------------------------

function appendEmittedBlock(emitted, parentId, childIds, childBlocks, ctx) {
  if (emitted.parent !== undefined) {
    childBlocks.push(emitted);

    return;
  }

  const childId = emitted.id !== undefined && emitted.id !== null ? emitted.id : ctx.generateId();

  childIds.push(childId);
  childBlocks.push({ ...emitted, id: childId, parent: parentId });
}

function expandLegacyBodyBlocks(bodyBlocks, parentId, ctx) {
  const childIds = [];
  const childBlocks = [];

  // Recurse through the full interpreter so nested legacy structures inside a
  // toggle/callout body are fully flattened rather than surviving as legacy
  // types (which would render as a stub). A single legacy block may expand
  // into N root-level siblings (e.g. a list with N items); every parent-less
  // root becomes a direct child here so nothing is orphaned. The WHOLE body is
  // expanded in one pass (not block-by-block) so sibling-consuming expanders
  // see their followers inside a container body too.
  const expanded = expandLegacyBlocks(bodyBlocks, ctx);

  for (const emitted of expanded) {
    appendEmittedBlock(emitted, parentId, childIds, childBlocks, ctx);
  }

  // Invariant: every emitted block either carries a parent ref (descendant
  // assigned during its own recursive expansion) or appears in childIds (a root
  // we just re-parented). A trip here means an expansion path is leaking
  // orphans — the regression this assertion exists to catch.
  for (const block of childBlocks) {
    const hasParent = block.parent !== undefined;
    const hasId = block.id !== undefined;
    const isDirectChild = hasId && childIds.includes(block.id);

    if (!hasParent && !isDirectChild) {
      throw new Error(
        `expandLegacyBodyBlocks: orphaned block emitted (type=${block.type}, id=${block.id == null ? '<none>' : block.id}). ` +
        `Every root-level expansion must be re-parented to ${parentId}.`
      );
    }
  }

  return { childIds, childBlocks };
}

// ---------------------------------------------------------------------------
// Per-type expanders. Each returns an array (1:1 → single element).
// ---------------------------------------------------------------------------

function expandListEntry(block, ctx) {
  return expandList(block.data, block.tunes, ctx);
}

function expandChecklistEntry(block, ctx) {
  return expandList({ style: 'checklist', items: block.data.items }, block.tunes, ctx);
}

function expandLinkToolEntry(block, ctx) {
  const meta = block.data.meta && typeof block.data.meta === 'object' ? block.data.meta : {};
  const image = typeof meta.image === 'object' && meta.image !== null ? meta.image.url : meta.image;

  if (meta.site_name !== undefined) {
    ctx.warn('linkTool', 'site_name', 'dropped');
  }

  return [{
    ...block,
    id: block.id != null ? block.id : ctx.generateId(),
    type: 'bookmark',
    data: {
      url: block.data.link,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
      ...(typeof image === 'string' ? { image } : {}),
      ...(meta.favicon !== undefined ? { favicon: meta.favicon } : {}),
      ...(meta.domain !== undefined ? { domain: meta.domain } : {}),
    },
  }];
}

function expandToggleListEntry(block, ctx) {
  const blocks = [];
  const toggleId = block.id != null ? block.id : ctx.generateId();
  const bodyBlocks = (block.data.body && block.data.body.blocks) || [];

  const { childIds, childBlocks } = expandLegacyBodyBlocks(bodyBlocks, toggleId, ctx);

  const sharedFields = {
    id: toggleId,
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  };

  const isOpenField = typeof block.data.isExpanded === 'boolean' ? { isOpen: block.data.isExpanded } : {};

  if (typeof block.data.titleVariant === 'number') {
    blocks.push({
      ...sharedFields,
      type: 'header',
      data: {
        text: block.data.title,
        level: block.data.titleVariant,
        isToggleable: true,
        ...isOpenField,
      },
    });
  } else {
    blocks.push({
      ...sharedFields,
      type: 'toggle',
      data: {
        text: block.data.title,
        ...isOpenField,
      },
    });
  }

  blocks.push(...childBlocks);

  return blocks;
}

function expandCalloutEntry(block, ctx) {
  const blocks = [];
  const calloutId = block.id != null ? block.id : ctx.generateId();
  const bodyBlocks = (block.data.body && block.data.body.blocks) || [];

  const { childIds, childBlocks } = expandLegacyBodyBlocks(bodyBlocks, calloutId, ctx);

  const variant = block.data.variant !== undefined ? block.data.variant : 'general';
  const backgroundColor = variant in VARIANT_TO_BG_PRESET ? VARIANT_TO_BG_PRESET[variant] : null;

  const emoji = block.data.isEmojiVisible === false
    ? ''
    : (block.data.emoji != null ? block.data.emoji : CALLOUT_DEFAULT_EMOJI);

  blocks.push({
    id: calloutId,
    type: 'callout',
    data: {
      emoji,
      textColor: null,
      backgroundColor,
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  });

  blocks.push(...childBlocks);

  return blocks;
}

function expandImageEntry(block, ctx) {
  const rawData = block.data || {};
  const {
    file,
    url: flatUrl,
    withBorder,
    withBackground,
    stretched,
    ...rest
  } = rawData;

  if (withBackground === true) {
    ctx.warn('image', 'withBackground', 'dropped');
  }

  const fileUrl = isPlainObject(file) ? file.url : undefined;
  const resolvedUrl = typeof fileUrl === 'string' ? fileUrl : flatUrl;
  const url = typeof resolvedUrl === 'string' ? resolvedUrl : '';

  return [{
    ...block,
    id: block.id != null ? block.id : ctx.generateId(),
    data: {
      url,
      ...rest,
      ...(withBorder === true ? { frame: 'border' } : {}),
      ...(stretched === true ? { size: 'full' } : {}),
    },
  }];
}

function expandQuoteEntry(block, ctx) {
  if (hasDefinedField(block.data, 'alignment')) {
    ctx.warn('quote', 'alignment', 'ignored');
  }

  const rawData = block.data || {};
  const { caption, alignment: _alignment, ...rest } = rawData;

  const quoteBlock = {
    ...block,
    id: block.id != null ? block.id : ctx.generateId(),
    data: rest,
  };

  if (typeof caption !== 'string' || caption.length === 0) {
    return [quoteBlock];
  }

  const captionBlock = {
    id: ctx.generateId(),
    type: 'paragraph',
    data: { text: caption },
  };

  return [quoteBlock, captionBlock];
}

function expandTableEntry(block, ctx) {
  const tableId = block.id != null ? block.id : ctx.generateId();
  const rawData = block.data || {};
  const { content: _content, withHeadings, withHeadingColumn, stretched, ...restData } = rawData;
  const rows = getTableContentRows(rawData) || [];
  const childBlocks = [];

  const newContent = rows.map((row) => {
    if (!Array.isArray(row)) {
      return row;
    }

    return row.map((cell) => {
      if (isCellWithBlockRefs(cell)) {
        return cell;
      }

      const text = typeof cell === 'string' ? cell : '';

      if (text.length === 0) {
        return { blocks: [] };
      }

      const cellId = ctx.generateId();

      childBlocks.push({
        id: cellId,
        type: 'paragraph',
        data: { text },
        parent: tableId,
      });

      return { blocks: [cellId] };
    });
  });

  const tableBlock = {
    ...block,
    id: tableId,
    data: {
      ...restData,
      withHeadings: withHeadings === true,
      withHeadingColumn: withHeadingColumn === true,
      ...(stretched === true ? { stretched: true } : {}),
      content: newContent,
    },
  };

  return [tableBlock, ...childBlocks];
}

function expandRawEntry(block, ctx) {
  const html = isPlainObject(block.data) ? block.data.html : undefined;

  return [{
    ...block,
    id: block.id != null ? block.id : ctx.generateId(),
    type: 'code',
    data: { code: typeof html === 'string' ? html : '' },
  }];
}

function expandWarningEntry(block, ctx) {
  const calloutId = block.id != null ? block.id : ctx.generateId();
  const data = block.data || {};
  const title = typeof data.title === 'string' ? data.title : '';
  const message = typeof data.message === 'string' ? data.message : '';

  const childBlocks = [];

  for (const text of [title, message]) {
    if (text.length === 0) {
      continue;
    }

    childBlocks.push({
      id: ctx.generateId(),
      type: 'paragraph',
      data: { text },
      parent: calloutId,
    });
  }

  const childIds = childBlocks.map((child) => child.id);

  const calloutBlock = {
    id: calloutId,
    type: 'callout',
    data: {
      emoji: WARNING_EMOJI,
      textColor: null,
      backgroundColor: 'orange',
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  };

  return [calloutBlock, ...childBlocks];
}

function expandAttachesEntry(block, ctx) {
  const data = block.data || {};
  const file = isPlainObject(data.file) ? data.file : {};
  const url = typeof file.url === 'string' ? file.url : '';
  const title = typeof data.title === 'string' ? data.title : undefined;

  if (file.name !== undefined || file.size !== undefined || file.extension !== undefined) {
    ctx.warn('attaches', 'file metadata', 'dropped');
  }

  return [{
    ...block,
    id: block.id != null ? block.id : ctx.generateId(),
    type: 'bookmark',
    data: {
      url,
      ...(title !== undefined ? { title } : {}),
    },
  }];
}

// ---------------------------------------------------------------------------
// THE GRAMMAR TABLE — single source of truth. Order matches the historical
// runtime dispatch order (the first matching entry wins).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LegacyGrammarEntry
 * @property {string} legacyType     - the Editor.js block `type`
 * @property {string} targetType     - the Blok block `type` it maps to (informational; used by docs generation)
 * @property {'1:1'|'1:N'} cardinality
 * @property {boolean} contributesNesting - whether presence implies hierarchical nesting (for hasHierarchy)
 * @property {string[]} lossyFields  - source fields dropped with no Blok equivalent
 * @property {string} docNote        - human-readable one-line note for the compatibility matrix
 * @property {(block: any) => boolean} detect
 * @property {((block: any) => boolean)} [detectNesting] - per-block nesting test; falls back to `contributesNesting`
 * @property {(block: any, ctx: any, position: { siblings: any[], index: number }) => any[] | { blocks: any[], consumed: number }} expand
 */

/** @type {LegacyGrammarEntry[]} */
const LEGACY_GRAMMAR = [
  {
    legacyType: 'list',
    targetType: 'list',
    cardinality: '1:N',
    contributesNesting: false,
    lossyFields: ['meta', 'counterType'],
    docNote: 'Nested `items[]` become flat `list` blocks (parent/content refs preserved).',
    detect: detectList,
    detectNesting: (block) => hasNestedListItems(block.data.items),
    expand: expandListEntry,
  },
  {
    legacyType: 'checklist',
    targetType: 'list',
    cardinality: '1:N',
    contributesNesting: false,
    lossyFields: [],
    docNote: 'Each item becomes a `list` block with `style: "checklist"`.',
    detect: detectChecklist,
    expand: expandChecklistEntry,
  },
  {
    legacyType: 'linkTool',
    targetType: 'bookmark',
    cardinality: '1:1',
    contributesNesting: false,
    lossyFields: ['meta.site_name'],
    docNote: '`{ link, meta }` → `bookmark` `{ url, title, description, image, favicon, domain }`.',
    detect: detectLinkTool,
    expand: expandLinkToolEntry,
  },
  {
    legacyType: 'toggleList',
    targetType: 'toggle',
    cardinality: '1:N',
    contributesNesting: true,
    lossyFields: [],
    docNote: '`toggleList` → `toggle` (or toggle `header` when `titleVariant` is set) + child body blocks.',
    detect: detectToggleList,
    detectNesting: hasLegacyBody,
    expand: expandToggleListEntry,
  },
  {
    legacyType: 'callout',
    targetType: 'callout',
    cardinality: '1:N',
    contributesNesting: true,
    lossyFields: [],
    docNote: 'Legacy `{ body, variant, emoji }` → flat `{ emoji, textColor, backgroundColor }` + child body blocks.',
    detect: detectCallout,
    detectNesting: hasLegacyBody,
    expand: expandCalloutEntry,
  },
  {
    legacyType: 'image',
    targetType: 'image',
    cardinality: '1:1',
    contributesNesting: false,
    lossyFields: ['withBackground'],
    docNote: '`@editorjs/image` `{ file: { url } }` and `@editorjs/simple-image` `{ url }` → flat `{ url, frame?, size? }`.',
    detect: detectImage,
    expand: expandImageEntry,
  },
  {
    legacyType: 'quote',
    targetType: 'quote',
    cardinality: '1:N',
    contributesNesting: false,
    lossyFields: ['alignment'],
    docNote: 'Non-empty `caption` becomes a following `paragraph`; `alignment` dropped.',
    detect: detectQuote,
    expand: expandQuoteEntry,
  },
  {
    legacyType: 'table',
    targetType: 'table',
    cardinality: '1:N',
    contributesNesting: true,
    lossyFields: [],
    docNote: 'HTML-string cells → Blok cell-block references + child paragraph blocks.',
    detect: detectTable,
    expand: expandTableEntry,
  },
  {
    legacyType: 'raw',
    targetType: 'code',
    cardinality: '1:1',
    contributesNesting: false,
    lossyFields: [],
    docNote: '`{ html }` → `code` `{ code: html }` (source shown verbatim).',
    detect: detectRaw,
    expand: expandRawEntry,
  },
  {
    legacyType: 'warning',
    targetType: 'callout',
    cardinality: '1:N',
    contributesNesting: true,
    lossyFields: [],
    docNote: '`{ title, message }` → ⚠️ orange `callout` with title/message child paragraphs.',
    detect: detectWarning,
    expand: expandWarningEntry,
  },
  {
    legacyType: 'attaches',
    targetType: 'bookmark',
    cardinality: '1:1',
    contributesNesting: false,
    lossyFields: ['file.name', 'file.size', 'file.extension'],
    docNote: '`{ file: { url }, title }` → `bookmark` (file metadata dropped).',
    detect: detectAttaches,
    expand: expandAttachesEntry,
  },
];

// ---------------------------------------------------------------------------
// The interpreter — the ONE forward-expand code path both consumers run.
// ---------------------------------------------------------------------------

const NOOP_WARN = function noopWarn() {};

/**
 * Normalize a caller-supplied ctx, filling in a no-op warn and requiring a
 * generateId. Keeps every expand() free of environment-detection branches.
 * @param {{ generateId: () => string, warn?: Function }} ctx
 */
function normalizeCtx(ctx) {
  if (!ctx || typeof ctx.generateId !== 'function') {
    throw new Error('expandLegacyBlocks: ctx.generateId is required');
  }

  return {
    generateId: ctx.generateId,
    warn: typeof ctx.warn === 'function' ? ctx.warn : NOOP_WARN,
    // Host-supplied grammar entries, matched BEFORE the built-in table so a host
    // can both cover a type Blok knows nothing about and override a built-in.
    rules: Array.isArray(ctx.rules) ? ctx.rules : [],
    // Whether to mint an id for PASSTHROUGH (non-migrated) blocks that lack one.
    // The runtime requires every block to carry an id, so it stamps (default).
    // The codemod is a source-rewrite tool that keeps untouched blocks
    // byte-identical, so it opts out — migrated/expanded blocks still get ids
    // from their expander (a split or flattened block genuinely needs one).
    stampMissingIds: ctx.stampMissingIds !== false,
  };
}

/**
 * Expand a flat array of blocks, replacing every legacy Editor.js shape with its
 * Blok equivalent (recursively, for container bodies). Blocks with no matching
 * grammar entry pass through unchanged except for a guaranteed id.
 *
 * @param {any[]} blocks
 * @param {{ generateId: () => string, warn?: (blockType: string, field: string, verb: string) => void }} ctx
 * @returns {any[]}
 */
/**
 * Normalize an expander's return value. An expander may return either a plain
 * array of blocks (consuming only the block it was handed) or
 * `{ blocks, consumed }` when it absorbed `consumed` FOLLOWING siblings — the
 * shape flat-with-count legacy formats need (a toggle storing its body as "the
 * next N blocks"). `consumed` is clamped to what actually remains, so a
 * truncated document can never over-consume or loop.
 * @param {any} result - the expander's return value
 * @param {number} remaining - siblings available after the expanded block
 */
function normalizeExpansion(result, remaining) {
  if (Array.isArray(result)) {
    return { blocks: result, consumed: 0 };
  }

  const blocks = Array.isArray(result.blocks) ? result.blocks : [];
  const requested = typeof result.consumed === 'number' ? Math.floor(result.consumed) : 0;
  const consumed = Math.max(0, Math.min(requested, remaining));

  return { blocks, consumed };
}

/**
 * The effective grammar for a pass: host entries first (so a host can override a
 * built-in), then the built-in table.
 * @param {any[]} rules
 */
function resolveGrammar(rules) {
  return rules && rules.length > 0 ? [...rules, ...LEGACY_GRAMMAR] : LEGACY_GRAMMAR;
}

/**
 * The per-block match primitive: which grammar entry (if any) claims this block.
 * Exposed because dispatching per block through the array-shaped helpers means
 * allocating a throwaway array and re-scanning the whole table for every block.
 * @param {any} block
 * @param {any[]} [rules] - host-supplied entries, matched before the built-ins
 * @returns {any|null} the matching entry, or null
 */
function matchLegacyRule(block, rules) {
  const entry = resolveGrammar(rules).find((candidate) => candidate.detect(block));

  return entry === undefined ? null : entry;
}

function expandLegacyBlocks(blocks, ctx) {
  const resolved = normalizeCtx(ctx);
  const grammar = resolveGrammar(resolved.rules);
  const out = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    const entry = grammar.find((candidate) => candidate.detect(block));

    if (entry) {
      const result = entry.expand(block, resolved, { siblings: blocks, index });
      const expansion = normalizeExpansion(result, blocks.length - index - 1);

      out.push(...expansion.blocks);
      index += 1 + expansion.consumed;
      continue;
    }

    if (resolved.stampMissingIds) {
      // Runtime policy: every block must carry an id; keep the historical
      // shallow-copy-on-passthrough semantics (never alias the input block).
      out.push({ ...block, id: block.id != null ? block.id : resolved.generateId() });
    } else {
      // Codemod policy: leave untouched blocks byte-identical (no id injection).
      out.push(block);
    }
    index++;
  }

  return out;
}

/**
 * Whether any block in the array matches a legacy grammar entry.
 * @param {any[]} blocks
 * @param {any[]} [rules] - host-supplied entries, matched before the built-ins
 */
function hasLegacyBlocks(blocks, rules) {
  return blocks.some((block) => matchLegacyRule(block, rules) !== null);
}

/**
 * Reproduce the runtime's legacy-format nesting heuristic: a legacy document is
 * considered "nested" when a matched entry either always implies structure
 * (`contributesNesting`, e.g. table/warning) or says so for this specific block
 * (`detectNesting`, e.g. a list with nested items, a toggle/callout with a
 * non-empty body). Host entries participate through the same two fields.
 * @param {any[]} blocks
 * @param {any[]} [rules] - host-supplied entries, matched before the built-ins
 */
function hasLegacyNesting(blocks, rules) {
  return blocks.some((block) => {
    const entry = matchLegacyRule(block, rules);

    if (entry === null) {
      return false;
    }

    return typeof entry.detectNesting === 'function'
      ? Boolean(entry.detectNesting(block))
      : Boolean(entry.contributesNesting);
  });
}

/**
 * Combined legacy-format analysis for the runtime's analyzeDataFormat wrapper.
 * @param {any[]} blocks
 * @param {any[]} [rules] - host-supplied entries, matched before the built-ins
 * @returns {{ hasLegacyBlocks: boolean, hasNesting: boolean }}
 */
function analyzeLegacyFormat(blocks, rules) {
  return {
    hasLegacyBlocks: hasLegacyBlocks(blocks, rules),
    hasNesting: hasLegacyNesting(blocks, rules),
  };
}

export {
  LEGACY_GRAMMAR,
  expandLegacyBlocks,
  matchLegacyRule,
  analyzeLegacyFormat,
  hasLegacyBlocks,
  hasLegacyNesting,
  createBlockIdGenerator,
  BLOCK_ID_ALPHABET,
  BLOCK_ID_LENGTH,
  VARIANT_TO_BG_PRESET,
  CALLOUT_DEFAULT_EMOJI,
  WARNING_EMOJI,
};
