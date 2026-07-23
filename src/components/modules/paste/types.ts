import type { PasteEvent } from '../../../../types';
import type { SanitizerRule } from '../../../../types/configs/sanitizer-config';
import type { Block } from '../../block';
import type { BlockToolAdapter } from '../../tools/block';

/**
 * Tag substitute object.
 */
export interface TagSubstitute {
  tool: BlockToolAdapter;
  sanitizationConfig?: SanitizerRule;
}

/**
 * Pattern substitute object.
 */
export interface PatternSubstitute {
  key: string;
  pattern: RegExp;
  tool: BlockToolAdapter;
  /** Resolution priority; higher wins. Defaults to 0. See PasteConfig.patternPriority. */
  priority: number;
}

/**
 * Files' types substitutions object.
 */
export interface FilesSubstitution {
  extensions: string[];
  mimeTypes: string[];
}

/**
 * Processed paste data object.
 */
export interface PasteData {
  tool: string;
  content: HTMLElement;
  event: PasteEvent;
  isBlock: boolean;
  /**
   * Index into the current paste batch that is this block's parent.
   * When set, `insertPasteData` will call `setBlockParent` after inserting.
   */
  parentPasteIndex?: number;
  /**
   * Initial tool data for the inserted block. Used for container tools that
   * need creation-time hints (e.g. `noSeed` on column/column_list so they
   * don't self-populate before their pasted children are parented).
   */
  toolData?: Record<string, unknown>;
}

/**
 * Context passed to handlers.
 */
export interface HandlerContext {
  canReplaceCurrentBlock: boolean;
  currentBlock?: Block;
  plainData?: string;
  /** The DOM element that was the target of the paste event. */
  pasteTarget?: Element;
}

/**
 * Pattern match result.
 */
export interface PatternMatch {
  key: string;
  data: string;
  tool: string;
  event: PasteEvent;
}

/**
 * Processed file result.
 */
export interface ProcessedFile {
  event: PasteEvent;
  type: string;
}
