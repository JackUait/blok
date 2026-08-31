import * as Y from 'yjs';

import type { OutputBlockData } from '../../../../types/data-formats/output-data';

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

    yblock.set('id', blockData.id);
    yblock.set('type', blockData.type);

    // Normalize empty paragraph data to { text: '' } for consistent undo/redo behavior
    const normalizedData = this.normalizeBlockData(blockData.type, blockData.data);

    yblock.set('data', this.objectToYMap(normalizedData));

    if (blockData.tunes !== undefined) {
      yblock.set('tunes', this.objectToYMap(blockData.tunes));
    }

    if (blockData.parent !== undefined) {
      yblock.set('parentId', blockData.parent);
    }

    if (blockData.content !== undefined) {
      yblock.set('contentIds', Y.Array.from(blockData.content));
    }

    if (blockData.lastEditedAt !== undefined) {
      yblock.set('lastEditedAt', blockData.lastEditedAt);
    }

    if (blockData.lastEditedBy !== undefined) {
      yblock.set('lastEditedBy', blockData.lastEditedBy);
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
      ymap.set(key, this.plainToYValue(value));
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
   */
  public isConvertibleArray(value: unknown): value is unknown[] {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((element) => element !== null && typeof element === 'object');
  }

  /**
   * Convert one plain value per the array rule. Primitives, primitive arrays
   * and empty arrays pass through as-is.
   */
  public plainToYValue(value: unknown): unknown {
    if (this.isConvertibleArray(value)) {
      const yarray = new Y.Array<unknown>();

      yarray.push(value.map((element) => this.plainToYValue(element)));

      return yarray;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return this.objectToYMap(value as Record<string, unknown>);
    }

    return value;
  }

  /**
   * Convert Y.Map to plain object
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      obj[key] = this.yValueToPlain(value);
    });

    return obj;
  }

  /**
   * Read-back of `plainToYValue`.
   */
  public yValueToPlain(value: unknown): unknown {
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
