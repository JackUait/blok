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
}

/**
 * Context passed to handlers.
 */
export interface HandlerContext {
  canReplaceCurrentBlock: boolean;
  currentBlock?: Block;
  plainData?: string;
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
