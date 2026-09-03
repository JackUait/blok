/**
 * Normalizes a saved document (`OutputData` or the loose wire shape) into the
 * lookup structures the view renderer walks: defensive per-block
 * normalization plus the flat-with-references hierarchy (`parent`/`content`
 * fields, mirroring what the Saver emits — see `makeOutput` in
 * `src/components/modules/saver.ts`).
 *
 * PURITY CONTRACT: no DOM access, no editor-module imports.
 */
import type { LooseOutputData, OutputData } from '../../types';

/**
 * A block after defensive normalization: guaranteed string `type` and object
 * `data`; `id` present only when it is a non-empty string.
 */
export interface ViewBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Lookup structures for one render run.
 */
export interface DocumentModel {
  /** Blocks with no (or unresolvable/dangling) parent, in document order. */
  topLevel: ViewBlock[];
  /** Every identified block, keyed by id (first occurrence wins). */
  byId: Map<string, ViewBlock>;
  /**
   * Structural children of a block, in document order.
   * @param id - parent block id (undefined → no children)
   */
  childrenOf(id: string | undefined): ViewBlock[];
}

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Normalize one raw block entry from the wire. Returns null for malformed
 * entries (non-objects, missing/empty `type`), which the renderer skips.
 * @param entry - raw entry from a blocks array
 */
export const normalizeViewBlock = (entry: unknown): ViewBlock | null => {
  if (!isRecord(entry) || typeof entry.type !== 'string' || entry.type === '') {
    return null;
  }

  return {
    ...(typeof entry.id === 'string' && entry.id !== '' ? { id: entry.id } : {}),
    type: entry.type,
    data: isRecord(entry.data) ? entry.data : {},
  };
};

/**
 * Read the structural parent reference from a raw block entry. The saved
 * output shape uses `parent`; `parentId` is accepted defensively (it is the
 * field name used by internal serializers).
 * @param entry - raw entry from a blocks array
 */
const parentIdOf = (entry: unknown): string | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const raw = entry.parent ?? entry.parentId;

  return typeof raw === 'string' && raw !== '' ? raw : null;
};

/**
 * Types whose LEGACY data nests its child blocks in `data.body.blocks[]`. A
 * current `toggle` keeps its children by reference like every other container.
 */
const LEGACY_BODY_TYPES = new Set(['callout', 'toggleList']);

/**
 * Types whose LEGACY data nests item text in `data.items[]`. A current `list`
 * block is flat — one block per item, nested by reference.
 */
const LEGACY_ITEM_TYPES = new Set(['list', 'checklist']);

/**
 * Turn one legacy list item into a `list` block, so every reader treats it the
 * way it treats a current one. An item is `{ content, items[] }`; the oldest
 * checklists name the field `text`, and a very old list stores a bare string.
 * Its own `items` ride along and are expanded by the same rule, one level down.
 * @param item - raw entry from a `data.items` array
 */
const legacyItemBlock = (item: unknown, style: unknown): unknown => {
  const listData = (text: unknown, source?: Record<string, unknown>): Record<string, unknown> => ({
    text,
    ...(typeof style === 'string' ? { style } : {}),
    ...(source !== undefined && Array.isArray(source.items) ? { items: source.items } : {}),
    /** A legacy checklist item carries its own tick; the current list block still reads `checked`. */
    ...(source !== undefined && typeof source.checked === 'boolean' ? { checked: source.checked } : {}),
  });

  if (typeof item === 'string') {
    return { type: 'list', data: listData(item) };
  }

  if (!isRecord(item)) {
    return null;
  }

  const text = [item.content, item.text].find((value) => typeof value === 'string') ?? '';

  return { type: 'list', data: listData(text, item) };
};

/**
 * The list style a legacy block's items inherit. A legacy `checklist` block is a
 * separate type; the current list expresses the same thing as a style, so the
 * type is what names it.
 * @param block - the normalized block to read
 */
const legacyStyle = (block: ViewBlock): unknown =>
  (block.type === 'checklist' ? 'checklist' : block.data.style);

/**
 * A legacy list block's items, or null when this is not one. A block that holds
 * items but no text of its own is nothing BUT its items: emitting it would add
 * an empty bullet and push every item a level too deep. An item block — which
 * this function also produces — does have text, so its own sub-items nest under
 * it as children instead.
 * @param block - the normalized block to read
 */
const legacyItemGroup = (block: ViewBlock): unknown[] | null => {
  const { data, type } = block;

  if (!LEGACY_ITEM_TYPES.has(type) || !Array.isArray(data.items)) {
    return null;
  }

  if (typeof data.text === 'string' && data.text !== '') {
    return null;
  }

  return data.items.map((item) => legacyItemBlock(item, legacyStyle(block))).filter((item) => item !== null);
};

/**
 * The child blocks a legacy block nests inside its own `data`, in reading
 * order. Empty for every current block — those keep their children by
 * reference, which the `parent`/`content` walk below already resolves.
 *
 * A legacy title becomes a leading paragraph rather than a field on the
 * container: `callout` has no text field of its own at all, so inventing one
 * would put content somewhere no renderer looks.
 * @param block - the normalized block to read
 */
const legacyChildren = (block: ViewBlock): unknown[] => {
  const { data, type } = block;

  const children: unknown[] = [];

  if (LEGACY_BODY_TYPES.has(type)) {
    if (typeof data.title === 'string' && data.title !== '') {
      children.push({ type: 'paragraph', data: { text: data.title } });
    }

    if (isRecord(data.body) && Array.isArray(data.body.blocks)) {
      data.body.blocks.forEach((child: unknown) => children.push(child));
    }

    return children;
  }

  /** `type: 'columns'` is legacy-only — the columns tool writes `column_list`/`column`. */
  if (type === 'columns' && Array.isArray(data.cols)) {
    data.cols.forEach((column: unknown) => {
      if (isRecord(column) && Array.isArray(column.blocks)) {
        column.blocks.forEach((child: unknown) => children.push(child));
      }
    });

    return children;
  }

  if (LEGACY_ITEM_TYPES.has(type) && Array.isArray(data.items)) {
    return data.items.map((item) => legacyItemBlock(item, legacyStyle(block))).filter((item) => item !== null);
  }

  return [];
};

/**
 * Build the document model for one render run.
 * @param input - saved document, tolerant of the loose wire shape and nullish input
 */
export const buildDocumentModel = (input: OutputData | LooseOutputData | null | undefined): DocumentModel => {
  const rawBlocks: unknown[] = Array.isArray(input?.blocks) ? input.blocks : [];

  const entries: Array<{ block: ViewBlock; parentId: string | null }> = [];
  const byId = new Map<string, ViewBlock>();

  /**
   * Every id the document itself uses, so a synthetic one given to a legacy
   * container can never collide with a real block and steal its children.
   */
  const takenIds = new Set<string>();

  for (const raw of rawBlocks) {
    if (isRecord(raw) && typeof raw.id === 'string' && raw.id !== '') {
      takenIds.add(raw.id);
    }
  }

  const synthetic = { count: 0 };

  /** An id for a legacy container that has none — children hang off an id. */
  const nextSyntheticId = (): string => {
    for (;;) {
      synthetic.count += 1;

      const id = `blok-legacy-${synthetic.count}`;

      if (!takenIds.has(id)) {
        takenIds.add(id);

        return id;
      }
    }
  };

  /**
   * Read one raw entry and whatever it nests inside its own `data`.
   * @param raw - raw entry from a blocks array, or from a legacy container
   * @param nestedParentId - the legacy container this came out of, if any
   */
  const visit = (raw: unknown, nestedParentId: string | null): void => {
    const block = normalizeViewBlock(raw);

    if (block === null) {
      return;
    }

    const parentId = nestedParentId ?? parentIdOf(raw);
    const group = legacyItemGroup(block);

    /** A list block that is only a wrapper for its items IS those items. */
    if (group !== null) {
      if (block.id !== undefined && !byId.has(block.id)) {
        byId.set(block.id, block);
      }

      for (const item of group) {
        visit(item, parentId);
      }

      return;
    }

    const children = legacyChildren(block);

    /**
     * Anything that came out of a legacy container needs an id even when it has
     * no children: the Markdown serializer treats an id-less block as top level,
     * so a claimed child without one is emitted twice — once inside its
     * container and once after it.
     */
    if (block.id === undefined && (children.length > 0 || nestedParentId !== null)) {
      block.id = nextSyntheticId();
    }

    entries.push({ block, parentId });

    if (block.id !== undefined && !byId.has(block.id)) {
      byId.set(block.id, block);
    }

    for (const child of children) {
      visit(child, block.id ?? null);
    }
  };

  for (const raw of rawBlocks) {
    visit(raw, null);
  }

  const topLevel: ViewBlock[] = [];
  const children = new Map<string, ViewBlock[]>();

  for (const { block, parentId } of entries) {
    /** Dangling/self parents promote the block to root — never drop content. */
    if (parentId === null || parentId === block.id || !byId.has(parentId)) {
      topLevel.push(block);
      continue;
    }

    const siblings = children.get(parentId) ?? [];

    siblings.push(block);
    children.set(parentId, siblings);
  }

  return {
    topLevel,
    byId,
    childrenOf: (id: string | undefined): ViewBlock[] => (id === undefined ? [] : children.get(id) ?? []),
  };
};
