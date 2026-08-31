import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import type { OutputBlockData } from '../../../../types/data-formats/output-data';

/** The NUL character. Kept as a code-point so no raw NUL byte lives in source. */
const NUL_CHAR = String.fromCharCode(0);

/**
 * Remove every NUL from a string. A NUL in ANY position aborts the .NET sync
 * server's yrs read — map key, string value, array element alike — and the abort
 * kills the whole server process, not just the read (Phase 2's probe matrix:
 * exit 134 for every position). There is no "safe" position, so no write site
 * may skip the strip. The browser client is the only guard, so every user string
 * entering the doc is scrubbed at the serializer write chokepoints. Fast path:
 * scan first, allocate a replacement only on a hit, so a clean write copies
 * nothing.
 */
export const stripNul = (value: string): string =>
  value.includes(NUL_CHAR) ? value.split(NUL_CHAR).join('') : value;

/**
 * Strip NUL from a value that is a string AT RUNTIME and pass anything else
 * through untouched. The block format is deliberately tolerant — `parent`,
 * `type` and `lastEditedBy` are typed `string` but a host may hand us null or
 * a non-string, and those shapes are pinned by the lockstep fixtures. Scrubbing
 * must never change what a tolerant write stores.
 */
export const stripNulIfString = (value: unknown): unknown =>
  typeof value === 'string' ? stripNul(value) : value;

/**
 * Deep NUL scrub for a value stored as a plain LEAF — a string, or a
 * primitive/mixed array that is NOT promoted to a Y.Array, or a plain object
 * nested inside such an array. Recurses through arrays and objects, stripping
 * both keys and string values. Fast path: returns the SAME reference when the
 * subtree holds no NUL, so a clean write allocates nothing.
 */
export const stripNulDeep = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return stripNul(value);
  }

  if (Array.isArray(value)) {
    // stripNulDeep returns the SAME reference for a clean element, so an
    // element-wise identity check tells us whether anything changed — return
    // the original array untouched when nothing did.
    const next = value.map((element) => stripNulDeep(element));

    return next.every((element, index) => element === value[index]) ? value : next;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const nextEntries = entries.map(
      ([key, nested]): [string, unknown] => [stripNul(key), stripNulDeep(nested)]
    );
    const unchanged = nextEntries.every(
      ([key, nested], index) => key === entries[index][0] && nested === entries[index][1]
    );

    return unchanged ? value : Object.fromEntries(nextEntries);
  }

  return value;
};

/**
 * Key of the row-container map inside a keyed grid wrapper: rowKey → row value.
 */
export const GRID_ROWS_KEY = '__rows';

/**
 * Key of the row-order array inside a keyed grid wrapper: the display sequence
 * of row keys.
 */
export const GRID_ORDER_KEY = '__rowKeys';

/**
 * Length of a generated row key. Keys are minted independently on every peer,
 * so they must be random, never counter-derived.
 */
const ROW_KEY_LENGTH = 10;

/**
 * Type alias for OutputBlockData with concrete types for the Yjs serializer.
 * Uses Record<string, unknown> for data to avoid the default `any` type.
 */
export type YjsOutputBlockData = OutputBlockData;

/**
 * Characters that mark potential undo checkpoint positions.
 */
export const BOUNDARY_CHARACTERS = new Set([
  ' ',   // space
  '\t',  // tab
  '.',   // period
  '?',   // question mark
  '!',   // exclamation
  ',',   // comma
  ';',   // semicolon
  ':',   // colon
]);

/**
 * Time in milliseconds to batch consecutive changes into a single undo entry.
 * This should be long enough to cover normal human typing speed (50-200ms between keystrokes).
 * Smart grouping logic calls stopCapturing() to force checkpoints at word boundaries.
 */
export const CAPTURE_TIMEOUT_MS = 500;

/**
 * Time in milliseconds to wait after a boundary character before creating a checkpoint.
 */
export const BOUNDARY_TIMEOUT_MS = 100;

/**
 * Check if a character is a boundary character that can trigger an undo checkpoint.
 * @param char - Single character to check
 * @returns true if the character is a boundary character
 */
export const isBoundaryCharacter = (char: string): boolean => {
  return BOUNDARY_CHARACTERS.has(char);
};

/**
 * Serializer for converting between Yjs and YjsOutputBlockData formats.
 * This is a stateless utility class - all methods are pure functions.
 */
export class YBlockSerializer {
  /**
   * Convert YjsOutputBlockData to Y.Map
   */
  public outputDataToYBlock(blockData: YjsOutputBlockData): Y.Map<unknown> {
    const yblock = new Y.Map<unknown>();

    // The id also becomes this block's KEY in DocumentStore's blocks map, so a
    // NUL here is the exact yrs-aborting hazard — stripped at both places.
    yblock.set('id', typeof blockData.id === 'string' ? stripNul(blockData.id) : blockData.id);
    yblock.set('type', stripNulIfString(blockData.type));

    // Normalize empty paragraph data to { text: '' } for consistent undo/redo behavior
    const normalizedData = this.normalizeBlockData(blockData.type, blockData.data);

    yblock.set('data', this.objectToYMap(normalizedData));

    if (blockData.tunes !== undefined) {
      yblock.set('tunes', this.objectToYMap(blockData.tunes));
    }

    if (blockData.parent !== undefined) {
      yblock.set('parentId', stripNulIfString(blockData.parent));
    }

    // EAGER, always — even with no children. A block Y.Map is created by ONE
    // peer, so creating its contentIds here makes that peer the single creator
    // of the array. Lazily creating it on first placement instead let two peers
    // concurrently `set('contentIds', freshArray)` on the same childless
    // container; map-set is last-writer-wins, so the loser's array was discarded
    // WITH the child id inside it and that child lost its membership forever.
    // With one shared array, concurrent first children merge as two inserts.
    // Read-back still drops an empty array (`yBlockToOutputData`), so the public
    // OutputData shape is unchanged.
    // Array.from first: `content` is typed string[] but the format tolerates a
    // non-array (a bare string spreads to characters, a number yields []), and
    // those shapes are pinned by the lockstep fixtures — mapping directly would
    // throw where a tolerant write used to succeed.
    yblock.set(
      'contentIds',
      Y.Array.from(
        Array.from((blockData.content ?? []) as Iterable<unknown>).map(stripNulIfString) as string[]
      )
    );

    if (blockData.lastEditedAt !== undefined) {
      yblock.set('lastEditedAt', blockData.lastEditedAt);
    }

    if (blockData.lastEditedBy !== undefined) {
      yblock.set('lastEditedBy', stripNulIfString(blockData.lastEditedBy));
    }

    return yblock;
  }

  /**
   * Convert a Y.Map block to YjsOutputBlockData.
   * Includes type validation to ensure data integrity.
   */
  public yBlockToOutputData(yblock: Y.Map<unknown>): YjsOutputBlockData {
    const id = yblock.get('id');
    const type = yblock.get('type');
    const data = yblock.get('data');

    if (typeof id !== 'string') {
      throw new Error('Block id must be a string');
    }

    if (typeof type !== 'string') {
      throw new Error('Block type must be a string');
    }

    if (!(data instanceof Y.Map)) {
      throw new Error('Block data must be a Y.Map');
    }

    const block: YjsOutputBlockData = {
      id,
      type,
      data: this.yMapToObject(data),
    };

    const tunes = yblock.get('tunes');

    if (tunes instanceof Y.Map && tunes.size > 0) {
      block.tunes = this.yMapToObject(tunes);
    }

    const parentId = yblock.get('parentId');

    if (typeof parentId === 'string') {
      block.parent = parentId;
    }

    const contentIds = yblock.get('contentIds');

    // Empty → no `content` key: the doc-side array always exists (see the eager
    // creation in `outputDataToYBlock`), but the PUBLIC OutputData shape must
    // not sprout `content: []` on every leaf block.
    // Cross-parent membership is NOT filtered here — this serializer sees one
    // block and cannot know a child's parentId; `DocumentStore.toJSON` applies
    // the membership/cycle view over the whole map.
    if (contentIds instanceof Y.Array && contentIds.length > 0) {
      block.content = contentIds.toArray();
    }

    const lastEditedAt = yblock.get('lastEditedAt');

    if (typeof lastEditedAt === 'number') {
      block.lastEditedAt = lastEditedAt;
    }

    const lastEditedBy = yblock.get('lastEditedBy');

    if (typeof lastEditedBy === 'string') {
      block.lastEditedBy = lastEditedBy;
    }

    return block;
  }

  /**
   * Convert plain object to Y.Map
   */
  public objectToYMap(obj: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(obj)) {
      ymap.set(stripNul(key), this.plainToYValue(value));
    }

    return ymap;
  }

  /**
   * The array rule: a non-empty plain array whose elements are ALL objects or
   * arrays converts to a Y.Array of recursively-converted elements, so
   * concurrent edits merge per element (table cells, schema properties).
   * Primitive arrays (any primitive/null element) and EMPTY arrays stay atomic
   * plain leaves — `blocks: []` must stay plain when later populated with
   * block-id strings, or two peers would race the representation itself.
   * `DocumentStore.deepAssignYArray` diffs against the same predicate; the
   * write path and the load path must never disagree on it.
   * An array of ARRAYS is a grid and takes the keyed shape instead — see
   * `isGridArray`.
   */
  public isConvertibleArray(value: unknown): value is unknown[] {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((element) => element !== null && typeof element === 'object');
  }

  /**
   * The grid rule: a convertible array whose elements are ALL arrays (a
   * table's rows, at any depth) converts to a KEYED wrapper instead of a
   * plain Y.Array of Y.Arrays, because Y.Array has no move — reordering it
   * means delete+insert, which recreates the row's CRDT container and throws
   * away a peer's concurrent edit inside it. Every element is keyed, empty
   * rows included, so deleting the last column (`[[], []]`) does not flip the
   * representation. Arrays of plain objects (database schema/views) are NOT
   * grids and keep the element-wise Y.Array behaviour.
   */
  public isGridArray(value: unknown): value is unknown[][] {
    return this.isConvertibleArray(value) && value.every((element) => Array.isArray(element));
  }

  /**
   * Whether a Y value is a keyed grid wrapper (the read-back counterpart of
   * `isGridArray`). Both container keys must be present with the right shape,
   * so a tool's plain object can never be mistaken for one.
   */
  public isGridMap(value: unknown): value is Y.Map<unknown> {
    return value instanceof Y.Map &&
      value.get(GRID_ROWS_KEY) instanceof Y.Map &&
      value.get(GRID_ORDER_KEY) instanceof Y.Array;
  }

  /**
   * Mint a row key. Random, never derived from position or a counter: two
   * peers insert rows without coordinating and must not collide.
   */
  public generateRowKey(): string {
    return nanoid(ROW_KEY_LENGTH);
  }

  /**
   * The row keys of a grid wrapper in display order, normalized: first
   * occurrence wins (concurrent reorders can duplicate a key) and keys with no
   * row container are dropped (a reorder racing a delete can strand one).
   * Row containers absent from the order array are appended, sorted by key, so
   * a concurrently-inserted row is never silently invisible.
   *
   * `DocumentStore.deepAssignYGrid` pairs against THIS list, so the read path
   * and the diff path must agree on the normalization exactly.
   */
  public gridRowKeys(gridMap: Y.Map<unknown>): string[] {
    const rows = gridMap.get(GRID_ROWS_KEY) as Y.Map<unknown>;
    const order = gridMap.get(GRID_ORDER_KEY) as Y.Array<string>;
    const seen = new Set<string>();
    const keys = order.toArray().filter((key) => {
      if (seen.has(key) || !rows.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

    const orphans = Array.from(rows.keys()).filter((key) => !seen.has(key)).sort();

    return [...keys, ...orphans];
  }

  /**
   * Read a keyed grid wrapper back as a plain array of rows.
   */
  public gridMapToPlain(gridMap: Y.Map<unknown>): unknown[] {
    const rows = gridMap.get(GRID_ROWS_KEY) as Y.Map<unknown>;

    return this.gridRowKeys(gridMap).map((key) => this.yValueToPlain(rows.get(key)));
  }

  /**
   * Convert one plain value per the grid rule, then the array rule. Primitives,
   * primitive arrays and empty arrays pass through the NUL scrub as leaves —
   * a string cell or a primitive-array row (table cells) is stored verbatim,
   * so its NUL must be stripped here rather than in a Y.Map/Y.Array branch.
   */
  public plainToYValue(value: unknown): unknown {
    if (this.isGridArray(value)) {
      return this.plainToGridMap(value);
    }

    if (this.isConvertibleArray(value)) {
      const yarray = new Y.Array<unknown>();

      yarray.push(value.map((element) => this.plainToYValue(element)));

      return yarray;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return this.objectToYMap(value as Record<string, unknown>);
    }

    return stripNulDeep(value);
  }

  /**
   * Build a keyed grid wrapper from plain rows, minting a fresh key per row.
   */
  public plainToGridMap(rows: unknown[]): Y.Map<unknown> {
    const gridMap = new Y.Map<unknown>();
    const rowMap = new Y.Map<unknown>();
    const order = new Y.Array<string>();
    const keys = rows.map(() => this.generateRowKey());

    rows.forEach((row, index) => rowMap.set(keys[index], this.plainToYValue(row)));
    order.push(keys);

    gridMap.set(GRID_ROWS_KEY, rowMap);
    gridMap.set(GRID_ORDER_KEY, order);

    return gridMap;
  }

  /**
   * Convert Y.Map to plain object.
   *
   * Every key is written with `defineProperty`, not `obj[key] = value`: for
   * the key `__proto__` a plain assignment invokes the prototype SETTER, so
   * the entry vanishes from the object (and an object-valued one silently
   * becomes the returned record's prototype). `JSON.parse` mints real own
   * `__proto__` properties, so a stored record can carry one and
   * `objectToYMap` writes it into the doc — the C# converter mirroring this
   * file keeps it, and read-back must too or the two sides disagree.
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      Object.defineProperty(obj, key, {
        value: this.yValueToPlain(value),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    });

    return obj;
  }

  /**
   * Read-back of `plainToYValue`. The grid branch must come FIRST — a keyed
   * grid IS a Y.Map, and reading it as an object would leak the row keys into
   * OutputData. Bare Y.Arrays of rows (a doc created before rows were keyed)
   * still read back through `yArrayToPlain`.
   */
  public yValueToPlain(value: unknown): unknown {
    if (this.isGridMap(value)) {
      return this.gridMapToPlain(value);
    }

    if (value instanceof Y.Map) {
      return this.yMapToObject(value);
    }

    if (value instanceof Y.Array) {
      return this.yArrayToPlain(value);
    }

    return value;
  }

  /**
   * Convert Y.Array to a plain array, recursing into Y.Map/Y.Array elements.
   */
  public yArrayToPlain(yarray: Y.Array<unknown>): unknown[] {
    return yarray.toArray().map((element) => this.yValueToPlain(element));
  }

  /**
   * Normalize block data for consistent undo/redo behavior.
   * Empty paragraph data {} is normalized to { text: '' } so undo reverts to
   * a state with an explicit text property rather than an empty object.
   *
   * Public so `DocumentStore.replaceBlockContent` can apply the SAME
   * normalization when rebuilding a block's `data` in place (turn-into /
   * markdown conversion), matching the `outputDataToYBlock` add path.
   */
  public normalizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    // Only normalize paragraph blocks with empty data
    if (type === 'paragraph' && Object.keys(data).length === 0) {
      return { text: '' };
    }

    return data;
  }
}
