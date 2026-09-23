import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import type { OutputBlockData } from '../../../../types/data-formats/output-data';

/** The NUL character. Kept as a code-point so no raw NUL byte lives in source. */
const NUL_CHAR = String.fromCharCode(0);

/**
 * Block data keys holding a long, user-typed string that two people edit at the
 * same instant. Stored as a `Y.Text` so concurrent typing merges per character
 * instead of the later write taking the whole field. Every other value stays an
 * atomic leaf, where last-writer-wins is the behaviour you want.
 *
 * Top-level block data only — a nested `text` (a table cell's) is written
 * through `assignYMapEntry` and stays a leaf.
 *
 * There is deliberately NO nested counterpart, unlike `ORDERED_ID_ARRAY_KEYS`.
 * The one real nested case is a database row's title, in
 * `data.properties[propertyId]` — but that same map holds a select's option id,
 * a date and a url, and property ids are `nanoid()`, so no key-name rule can
 * tell prose from them. Merging the others per character INVENTS a value
 * neither peer picked (measured: option `o1` → `o2` and `o3` merges to `o23`,
 * which matches no option and drops the card into a labelless orphan column;
 * `2026-09-21` → Sep 22 and Oct 21 merges to `2026-10-22`). The only signal
 * that separates them is the property TYPE, which lives in the PARENT database
 * block's `data.schema` — concurrently edited state in another block. Two peers
 * disagreeing about the schema for one instant would mint a `Y.Text` on one
 * side and a leaf on the other for the SAME key, and `assignYMapEntry`'s
 * plain-leaf branch then `set`s the string over the peer's `Y.Text` — silent,
 * permanent loss of merging. A representation rule must be a race-free
 * function of the key path alone, computable identically here and in
 * `YDocConverter.cs`. A row title merging needs a top-level key on the row
 * block, not a nested rule here.
 */
const DIFFABLE_TEXT_KEYS = new Set(['text', 'code', 'caption', 'title', 'alt', 'artist']);

/** Whether a block's top-level data key holds mergeable text. */
export const isDiffableTextKey = (key: string): boolean => DIFFABLE_TEXT_KEYS.has(key);

/**
 * NESTED data keys holding a LIST THAT IS BORN EMPTY and then grows on two
 * peers at once: a table cell's `blocks` (ordered child ids), and a database
 * view's `filters` and `sorts`. Stored as a `Y.Array` from birth — empty, and
 * whatever the elements turn out to be — so two peers each adding the FIRST
 * element keep both instead of one whole-value write discarding the other's.
 *
 * The general array rule cannot cover them: `isConvertibleArray` promotes only
 * non-empty arrays, so a list born `[]` is a plain leaf, and each peer's first
 * element then `set`s a whole fresh `Y.Array` over the key — map-set is
 * last-writer-wins and the loser's element goes with the map it was in.
 * (A cell's `blocks` also holds strings, which the rule never promotes at all.)
 *
 * EAGER, at the container's single creation site, for the same reason
 * `contentIds` and `tunes` are minted eagerly on a bare block: a LAZY promotion
 * runs on two peers at once and is the very race being closed.
 *
 * NESTED only, by construction: `objectToYMap` and `assignYMapEntry` are the
 * only readers, and a block's TOP-LEVEL data map is built by `blockDataToYMap`
 * and written by `updateBlockData`, neither of which consults this set. A
 * custom tool's top-level `data.blocks` therefore keeps the old behaviour.
 *
 * OUTRANKED by the keyed wrapper: an array under one of these keys that is a
 * grid or carries unique ids takes the wrapper instead (see `objectToYMap`).
 * It is a container too, and it pairs by key rather than by position.
 *
 * LOCKSTEP: `OrderedIdArrayKeys` in
 * packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs must name exactly
 * the same keys AND defer to the wrapper the same way, or a server-seeded
 * container is a plain array where a client-seeded one is a Y.Array.
 */
const EAGER_ARRAY_KEYS = new Set(['blocks', 'filters', 'sorts']);

/**
 * Whether a NESTED data key is always stored as a Y.Array, empty included.
 * Named for the historical case (a cell's ordered child ids); the set now
 * covers every nested list born empty — see `EAGER_ARRAY_KEYS`.
 */
export const isOrderedIdArrayKey = (key: string): boolean => EAGER_ARRAY_KEYS.has(key);

/**
 * Remove every NUL from a string. A NUL in ANY position — map key, string
 * value, array element — aborts the .NET sync server's yrs read, and the
 * abort kills the whole server process, so no write site may skip the strip.
 * The browser client is the only guard: every user string entering the doc
 * is scrubbed at the serializer write chokepoints. Fast path: scan first,
 * allocate a replacement only on a hit, so a clean write copies nothing.
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
 * How many times one value may be replaced by its own `toJSON` result before
 * the write is refused. A `toJSON` returning its receiver, or two whose
 * `toJSON`s return each other, or one minting a fresh `toJSON` object every
 * call, would otherwise substitute forever — and identity bookkeeping catches
 * only the first two. Any honest chain is one or two links long.
 */
const MAX_TO_JSON_SUBSTITUTIONS = 32;

/**
 * The JSON-shaped stand-in for an object Yjs cannot carry, or the value itself
 * when it needs none.
 *
 * Everything below `plainToYValue`'s object branch — and lib0's own encoder —
 * reads an object through `Object.entries`. A `Date`, a `Map`, a `Set` or a
 * `RegExp` has no own enumerable entries, so it was stored as an EMPTY map:
 * the value was destroyed before the update left the peer that wrote it, with
 * no error and nothing in the document to show it had ever been there.
 *
 * Converted rather than rejected, because block data is JSON by contract and a
 * lost value is worse than a degraded one. Only `Date` has a stand-in
 * `JSON.stringify` would agree with (its own `toJSON`). For the rest this
 * function INVENTS one — `JSON.stringify` renders a `Set`, a `Map` and a
 * `RegExp` as `{}`, which is the very emptiness being avoided — so a `Set`
 * becomes its elements, a `Map` its entries and a `RegExp` its literal text
 * (`String(re)`: delimiters and flags, NOT the bare `source`).
 *
 * `toJSON` wins whenever an object has one, own enumerable fields included: a
 * `class Money { cents; currency; toJSON() }` is stored as what its `toJSON`
 * returns, because that is what the host's own `JSON.stringify` of the saved
 * data would have produced and the doc must not disagree with it. Merge
 * granularity follows the RESULT: a `toJSON` returning a plain object still
 * gets a per-field `Y.Map` and a per-field merge, and only one returning a
 * primitive makes the key a whole-value leaf.
 *
 * RE-ENTERED on its own result, not returned after one substitution. A
 * `toJSON` may hand back another value Yjs cannot carry, and that result lands
 * in the very `Object.entries` walk this function exists to prevent — as an
 * empty map, the silent loss described above. It is the SAME slot, so no caller re-enters it;
 * only this function does. It terminates on `MAX_TO_JSON_SUBSTITUTIONS` and
 * refuses the write, which is what `JSON.stringify` does with a cycle too.
 * `substitutions` counts that chain and is never passed by a caller.
 * The Set/Map/RegExp results are terminal by construction — an array, a plain
 * object or a string — and their CONTENTS re-enter through the callers'
 * per-element recursion.
 *
 * Left ALONE: a Yjs shared type (it is stored as itself) and a class instance
 * with NO `toJSON` — `Object.entries` reads its own fields correctly and
 * deep-merges them per field.
 *
 * NOT rescued: binary. A typed array has no `toJSON`, so it reaches
 * `plainToYValue`'s object branch and becomes a `Y.Map` of index → byte; a raw
 * `ArrayBuffer` has no own entries at all and becomes an empty one. Both are
 * exactly what the host's `JSON.stringify` of that data produces, and block
 * data is JSON by contract, so neither is a loss this function must invent a
 * shape for. lib0 can encode a `Uint8Array` natively but never gets the
 * chance — the object branch claims it first.
 *
 * KNOWN LIMITATION, a `Map` with keys that are not strings: distinct
 * stringified keys give the readable object shape, colliding ones give the
 * entry PAIRS, which `plainToYValue` then reads as a grid and wraps. So adding
 * a colliding key to a Map-valued field flips the stored shape through one
 * last-writer-wins `set`. Left as is: such a Map has no JSON form at all
 * (`JSON.stringify` gives `{}`), so the pairs are already a rescue past the
 * contract, and making the shape stable would cost either the per-field merge
 * every string-keyed Map gets or a bespoke envelope the C# converter would
 * have to learn.
 */
export const toSerializableValue = (value: unknown, substitutions = 0): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    value instanceof Y.AbstractType) {
    return value;
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    if (substitutions >= MAX_TO_JSON_SUBSTITUTIONS) {
      throw new TypeError('Converting circular structure to a block value');
    }

    return toSerializableValue((value as { toJSON: () => unknown }).toJSON(), substitutions + 1);
  }

  if (value instanceof Set) {
    return Array.from(value);
  }

  if (value instanceof Map) {
    const entries = Array.from(value, ([key, entry]): [unknown, unknown] => [key, entry]);
    const keys = entries.map(([key]) => String(key));

    // Object keys are strings, so two object keys both stringify to
    // "[object Object]" and an N-entry map would collapse to ONE — silent loss
    // inside the function written to stop it. Keep the readable object shape
    // only while the stringified keys stay distinct; otherwise store the
    // entry PAIRS, which lose nothing.
    return new Set(keys).size === keys.length
      ? Object.fromEntries(entries.map(([, entry], index) => [keys[index], entry]))
      : entries;
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  return value;
};

/**
 * Deep NUL scrub for a value stored as a plain LEAF — a string, or a
 * primitive/mixed array that is NOT promoted to a Y.Array, or a plain object
 * nested inside such an array. Recurses through arrays and objects, stripping
 * both keys and string values. Fast path: returns the SAME reference when the
 * subtree holds no NUL, so a clean write allocates nothing.
 */
export const stripNulDeep = (input: unknown): unknown => {
  // A leaf can still hold an exotic object inside it (`[1, new Date()]` is a
  // mixed array, so it is stored as a leaf and never reaches `plainToYValue`
  // again) — normalize here too or the entries walk below empties it.
  const value = toSerializableValue(input);

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
 * Deepest value level read back from a block's `data`/`tunes`; anything
 * nested further exports as `null`. A peer can write thousands of nested
 * maps in one small update, and the readers run inside the observer during
 * `Y.applyUpdate` — a stack overflow there ends every member's session.
 *
 * Levels count on the PLAIN shape, which the C# converter mirrors: a value
 * directly inside `data` is level 1, each enclosing object or array adds one,
 * a keyed grid is ONE level (its two wrapper maps do not exist in JSON), and
 * an atomic leaf (primitive array included) is one value at its level.
 * Matches the server update inspector's 256.
 */
export const MAX_VALUE_DEPTH = 256;

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

    yblock.set('data', this.blockDataToYMap(normalizedData));

    // EAGER, always — the same law as `contentIds` below and the `Y.Text` in
    // `blockDataToYMap`: a container two peers can create must be minted by the
    // ONE peer that creates the block. Created lazily on the first tune write
    // instead, two peers each `set('tunes', freshMap)` on a tuneless block, and
    // map-set is last-writer-wins — the loser's map was discarded WITH the tune
    // inside it. With one shared map, two different tunes merge as two sets.
    // Read-back still drops an empty map (`yBlockToOutputData`), so the public
    // OutputData shape is unchanged.
    // LOCKSTEP: `InputWriter.Block` in
    // packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs must write a
    // `tunes` map on EVERY block too, or a server-seeded block still carries
    // the lazy-birth race this eager mint exists to close.
    yblock.set('tunes', this.objectToYMap(blockData.tunes ?? {}));

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
   * Whether a blocks-map value can be exported: a Y.Map whose `id` and `type`
   * are strings and whose `data` is a Y.Map. Anything else is a foreign
   * writer's shape and is skipped — never thrown on, since the readers run
   * inside the observer. Shared by `yBlockToOutputData` and
   * `DocumentStore.orderedIds`, so the id-only order and the export agree.
   */
  public isWellFormedBlock(yblock: unknown): yblock is Y.Map<unknown> {
    return yblock instanceof Y.Map &&
      typeof yblock.get('id') === 'string' &&
      typeof yblock.get('type') === 'string' &&
      yblock.get('data') instanceof Y.Map;
  }

  /**
   * Convert a Y.Map block to YjsOutputBlockData, or null for a malformed one
   * (see `isWellFormedBlock`).
   */
  public yBlockToOutputData(yblock: Y.Map<unknown>): YjsOutputBlockData | null {
    if (!this.isWellFormedBlock(yblock)) {
      return null;
    }

    const block: YjsOutputBlockData = {
      id: yblock.get('id') as string,
      type: yblock.get('type') as string,
      data: this.yMapToObject(yblock.get('data') as Y.Map<unknown>),
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
   * A block's `data`, with mergeable text stored as a `Y.Text`.
   *
   * EAGER and at the single creation site, for the same reason `contentIds`
   * is: a block's Y.Map is built by ONE peer, so minting the `Y.Text` here
   * makes that peer its single creator and every other peer reaches the same
   * item through the wire. Upgrading a plain string lazily instead lets two
   * peers `set(key, freshText)` at once, and map-set is last-writer-wins — the
   * loser's container is discarded with everything typed into it.
   *
   * Read-back is unchanged: `yValueToPlain` renders a shared type through
   * `toJSON()`, and an unformatted `Y.Text`'s is the string it holds.
   * @param data - the block's plain data object
   */
  public blockDataToYMap(data: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(data)) {
      const dataKey = stripNul(key);

      ymap.set(
        dataKey,
        isDiffableTextKey(dataKey) && typeof value === 'string'
          ? new Y.Text(stripNul(value))
          : this.plainToYValue(value)
      );
    }

    return ymap;
  }

  /**
   * Convert plain object to Y.Map
   *
   * The eager-array rule runs only for an array the KEYED wrapper does not
   * already claim. `plainToYValue` gives a grid or an id-bearing array a
   * wrapper, which is a container too and pairs by key instead of by position
   * — forcing a plain Y.Array on it because the key happens to be named
   * `filters`/`sorts` would reintroduce "a reorder racing a field edit lands
   * on whichever element took the index".
   * LOCKSTEP: `InputWriter`'s ordered-id branch in
   * packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs must defer the
   * same way.
   */
  public objectToYMap(obj: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(obj)) {
      const mapKey = stripNul(key);
      const eager = isOrderedIdArrayKey(mapKey) && Array.isArray(value) &&
        !this.isGridArray(value) && !this.isIdentityArray(value);

      ymap.set(mapKey, eager ? this.plainToYArray(value) : this.plainToYValue(value));
    }

    return ymap;
  }

  /**
   * A plain array as a Y.Array, element-wise, WHATEVER the elements are —
   * empty and all-primitive included, unlike `plainToYValue`. Only the
   * ordered-id-array rule uses it; everything else must keep the array rule's
   * atomic-leaf behaviour.
   */
  public plainToYArray(value: unknown[]): Y.Array<unknown> {
    const yarray = new Y.Array<unknown>();

    yarray.push(value.map((element) => this.plainToYValue(element)));

    return yarray;
  }

  /**
   * The array rule: a non-empty plain array whose elements are ALL objects or
   * arrays converts to a Y.Array of recursively-converted elements, so
   * concurrent edits merge per element (table cells, schema properties).
   * Primitive arrays (any primitive/null element) and EMPTY arrays stay atomic
   * plain leaves. A NESTED `blocks` key is the one exception and never reaches
   * this predicate: it is minted as a Y.Array at birth by the ordered-id-array
   * rule, precisely so no later promotion can race the representation.
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
   * grids and keep the element-wise Y.Array behaviour — they take the keyed
   * shape through `isIdentityArray` instead, keyed by their own `id`.
   */
  public isGridArray(value: unknown): value is unknown[][] {
    return this.isConvertibleArray(value) && value.every((element) => Array.isArray(element));
  }

  /**
   * The identity rule: an array whose elements are ALL plain objects carrying
   * a unique non-empty string `id` (a database's `schema`, a select's
   * `config.options`, a database's `views`) takes the SAME keyed wrapper a
   * grid does, keyed by the element's own id instead of a minted key.
   *
   * Same reason as the grid rule, one shape further out: Y.Array has no move,
   * so a positional diff writes a reorder as delete+insert. That recreates the
   * element's Y.Map, and a peer's concurrent field edit — measured: a column
   * RENAME — lands on whatever object ended up at that index instead. Both
   * peers then converge on the same wrong label, so nobody can see it.
   *
   * Uniqueness is required: duplicate ids cannot address distinct containers,
   * so such an array keeps the plain Y.Array behaviour rather than collapsing.
   *
   * Read-back is `gridMapToPlain` either way, so OutputData is unchanged and a
   * document written before this rule (a plain Y.Array) still reads and diffs
   * exactly as it did — there is no promotion, only a new birth shape.
   *
   * LOCKSTEP: `InputWriter.IsIdentityArray` / `PlainToIdentityMap` in
   * packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs must recognise
   * exactly the same arrays. If one side stores a database `schema`/`views`
   * list as this keyed wrapper and the other as a plain array, the same field
   * is two different CRDT types and an edit to it is lost with no error.
   */
  public isIdentityArray(value: unknown): value is Record<string, unknown>[] {
    if (!this.isConvertibleArray(value) || this.isGridArray(value)) {
      return false;
    }

    // Compared AFTER the NUL scrub, because that is the form the key is stored
    // in: two ids differing only by a NUL would address one container.
    const keys = value.map((element) => {
      const id = Array.isArray(element) ? undefined : (element as Record<string, unknown>).id;

      return typeof id === 'string' ? stripNul(id) : '';
    });

    return keys.every((key) => key.length > 0) && new Set(keys).size === keys.length;
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
   * The id a grid row names itself by: the `rowId` every one of its cells
   * carries (a table row). Undefined when the row is empty, a cell lacks it, or
   * the cells disagree — such a row gets a minted key and is paired by content.
   *
   * LOCKSTEP: `InputWriter.GridRowId` in
   * packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs.
   */
  public gridRowId(row: unknown): string | undefined {
    if (!Array.isArray(row) || row.length === 0) {
      return undefined;
    }

    const ids = row.map((cell: unknown) =>
      cell !== null && typeof cell === 'object' && !Array.isArray(cell)
        ? (cell as Record<string, unknown>).rowId
        : undefined);
    const [first] = ids;

    if (typeof first !== 'string' || !ids.every((id) => id === first)) {
      return undefined;
    }

    const key = stripNul(first);

    return key.length > 0 ? key : undefined;
  }

  /**
   * The key a new grid row is stored under: its own row id when it has one no
   * other row holds, else a minted key.
   * @param row - the plain row
   * @param taken - keys already in use in this grid
   */
  public newGridRowKey(row: unknown, taken: Set<string>): string {
    const id = this.gridRowId(row);

    return id !== undefined && !taken.has(id) ? id : this.generateRowKey();
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
   * Read a keyed grid wrapper back as a plain array of rows. The grid is one
   * level (`depth`); its rows are the next.
   */
  public gridMapToPlain(gridMap: Y.Map<unknown>, depth = 0): unknown[] {
    const rows = gridMap.get(GRID_ROWS_KEY) as Y.Map<unknown>;

    return this.gridRowKeys(gridMap).map((key) => this.yValueToPlain(rows.get(key), depth + 1));
  }

  /**
   * Convert one plain value per the grid rule, then the array rule. Primitives,
   * primitive arrays and empty arrays pass through the NUL scrub as leaves —
   * a string cell or a primitive-array row (table cells) is stored verbatim,
   * so its NUL must be stripped here rather than in a Y.Map/Y.Array branch.
   */
  public plainToYValue(input: unknown): unknown {
    // Not recursed here: `toSerializableValue` loops on its OWN slot until the
    // value is one Yjs carries, and every branch below re-enters this method
    // (or `stripNulDeep`) per element/field, so a nested exotic value is
    // normalized on its own way through.
    const value = toSerializableValue(input);

    if (this.isGridArray(value)) {
      return this.plainToGridMap(value);
    }

    if (this.isIdentityArray(value)) {
      return this.plainToIdentityMap(value);
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
    const taken = new Set<string>();
    const keys = rows.map((row) => {
      const key = this.newGridRowKey(row, taken);

      taken.add(key);

      return key;
    });

    rows.forEach((row, index) => rowMap.set(keys[index], this.plainToYValue(row)));
    order.push(keys);

    gridMap.set(GRID_ROWS_KEY, rowMap);
    gridMap.set(GRID_ORDER_KEY, order);

    return gridMap;
  }

  /**
   * Build a keyed wrapper from id-bearing objects, keyed by each element's own
   * id. Same container shape as a grid's, so `isGridMap`/`gridMapToPlain` read
   * both back identically; only the key SOURCE differs — an id is already
   * stable across peers, so there is nothing to mint.
   */
  public plainToIdentityMap(elements: Record<string, unknown>[]): Y.Map<unknown> {
    const wrapper = new Y.Map<unknown>();
    const rowMap = new Y.Map<unknown>();
    const order = new Y.Array<string>();
    // `isIdentityArray` guarantees a non-empty string id on every element.
    const keys = elements.map((element) => stripNul(String(element.id)));

    elements.forEach((element, index) => rowMap.set(keys[index], this.plainToYValue(element)));
    order.push(keys);

    wrapper.set(GRID_ROWS_KEY, rowMap);
    wrapper.set(GRID_ORDER_KEY, order);

    return wrapper;
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
  public yMapToObject(ymap: Y.Map<unknown>, depth = 0): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      Object.defineProperty(obj, key, {
        value: this.yValueToPlain(value, depth + 1),
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
   * @param depth - this value's level (see `MAX_VALUE_DEPTH`); past the cap
   *   the value reads as null instead of recursing
   */
  public yValueToPlain(value: unknown, depth = 0): unknown {
    if (depth > MAX_VALUE_DEPTH) {
      return null;
    }

    if (this.isGridMap(value)) {
      return this.gridMapToPlain(value, depth);
    }

    if (value instanceof Y.Map) {
      return this.yMapToObject(value, depth);
    }

    if (value instanceof Y.Array) {
      return this.yArrayToPlain(value, depth);
    }

    // A block's mergeable text is a Y.Text and reads back through `toJSON()`
    // as the string it holds, so OutputData is unchanged. A foreign or
    // future-format client can nest other shared types; falling through would
    // leak a live shared object (or a subdocument) into OutputData.
    if (value instanceof Y.Doc) {
      return null;
    }

    if (value instanceof Y.AbstractType) {
      const plain: unknown = value.toJSON();

      return plain;
    }

    return value;
  }

  /**
   * Convert Y.Array to a plain array, recursing into Y.Map/Y.Array elements.
   */
  public yArrayToPlain(yarray: Y.Array<unknown>, depth = 0): unknown[] {
    return yarray.toArray().map((element) => this.yValueToPlain(element, depth + 1));
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
