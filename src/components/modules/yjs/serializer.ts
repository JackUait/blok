import * as Y from 'yjs';

import type { OutputBlockData } from '../../../../types/data-formats/output-data';

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
 * Serializer for converting between Yjs and OutputBlockData formats.
 * This is a stateless utility class - all methods are pure functions.
 */
export class YBlockSerializer {
  /**
   * Convert OutputBlockData to Y.Map
   */
  public outputDataToYBlock(blockData: OutputBlockData): Y.Map<unknown> {
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

    return yblock;
  }

  /**
   * Convert a Y.Map block to OutputBlockData.
   * Includes type validation to ensure data integrity.
   */
  public yBlockToOutputData(yblock: Y.Map<unknown>): OutputBlockData {
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

    const block: OutputBlockData = {
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

    return block;
  }

  /**
   * Convert plain object to Y.Map
   */
  public objectToYMap(obj: Record<string, unknown>): Y.Map<unknown> {
    const ymap = new Y.Map<unknown>();

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        ymap.set(key, this.objectToYMap(value as Record<string, unknown>));
      } else {
        ymap.set(key, value);
      }
    }

    return ymap;
  }

  /**
   * Convert Y.Map to plain object
   */
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    ymap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        obj[key] = this.yMapToObject(value);
      } else {
        obj[key] = value;
      }
    });

    return obj;
  }

  /**
   * Normalize block data for consistent undo/redo behavior.
   * Empty paragraph data {} is normalized to { text: '' } so undo reverts to
   * a state with an explicit text property rather than an empty object.
   */
  private normalizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    // Only normalize paragraph blocks with empty data
    if (type === 'paragraph' && Object.keys(data).length === 0) {
      return { text: '' };
    }

    return data;
  }
}
