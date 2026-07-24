/**
 * Hand-authored types for the zero-dependency legacy migration grammar
 * (`legacy-grammar.mjs`). Co-located in `src/` — the published-types-no-src law
 * only constrains files under `types/`.
 */
import type { OutputBlockData } from '../../../types';

/**
 * What a CALLER hands `expandLegacyBlocks`. Only `generateId` is required; the
 * interpreter fills in the rest before any expander runs.
 */
export interface LegacyExpandOptions {
  generateId(): string;
  warn?(blockType: string, field: string, verb: 'dropped' | 'ignored'): void;
  /**
   * Whether to mint an id for passthrough (non-migrated) blocks that lack one.
   * Defaults to `true` (runtime requires ids); the codemod passes `false` to
   * keep untouched blocks byte-identical.
   */
  stampMissingIds?: boolean;
  /**
   * Host-supplied grammar entries, matched BEFORE the built-in table (so a host
   * can cover an unknown legacy type or override a built-in mapping).
   */
  rules?: LegacyGrammarEntry[];
}

/**
 * What every `expand()` RECEIVES — the caller's options after normalization, so
 * the transforms stay pure and an expander can call `ctx.warn(...)` without a
 * guard. The runtime supplies nanoid ids + a deduping `console.warn`; the
 * codemod supplies locally-minted ids + a no-op warn.
 */
export interface LegacyExpandContext {
  generateId(): string;
  warn(blockType: string, field: string, verb: 'dropped' | 'ignored'): void;
  stampMissingIds: boolean;
}

/**
 * Where the expanded block sits in the array being expanded — lets an expander
 * absorb following siblings (flat-with-count legacy formats).
 */
export interface LegacyExpandPosition {
  siblings: OutputBlockData[];
  index: number;
}

/**
 * An expander returns either the blocks it produced, or those blocks plus the
 * number of FOLLOWING siblings it absorbed. `consumed` is clamped to what
 * actually remains, so a truncated document can never over-consume.
 */
export interface LegacyExpansion {
  blocks: OutputBlockData[];
  consumed: number;
}

export interface LegacyGrammarEntry {
  legacyType: string;
  targetType: string;
  cardinality: '1:1' | '1:N';
  contributesNesting: boolean;
  lossyFields: string[];
  docNote: string;
  detect(block: OutputBlockData): boolean;
  /**
   * Per-block nesting test for entries whose structure depends on the data (a
   * list with nested items, a toggle with a non-empty body). Falls back to
   * `contributesNesting` when absent.
   */
  detectNesting?(block: OutputBlockData): boolean;
  expand(
    block: OutputBlockData,
    ctx: LegacyExpandContext,
    position: LegacyExpandPosition
  ): OutputBlockData[] | LegacyExpansion;
}

export interface LegacyFormatAnalysis {
  hasLegacyBlocks: boolean;
  hasNesting: boolean;
}

export const LEGACY_GRAMMAR: LegacyGrammarEntry[];

export function expandLegacyBlocks(
  blocks: OutputBlockData[],
  ctx: LegacyExpandOptions
): OutputBlockData[];

export function matchLegacyRule(
  block: OutputBlockData,
  rules?: LegacyGrammarEntry[]
): LegacyGrammarEntry | null;

export function analyzeLegacyFormat(
  blocks: OutputBlockData[],
  rules?: LegacyGrammarEntry[]
): LegacyFormatAnalysis;

export function hasLegacyBlocks(blocks: OutputBlockData[], rules?: LegacyGrammarEntry[]): boolean;

export function hasLegacyNesting(blocks: OutputBlockData[], rules?: LegacyGrammarEntry[]): boolean;

export function createBlockIdGenerator(): () => string;

export const BLOCK_ID_ALPHABET: string;
export const BLOCK_ID_LENGTH: number;
export const VARIANT_TO_BG_PRESET: Record<string, string | null>;
export const CALLOUT_DEFAULT_EMOJI: string;
export const WARNING_EMOJI: string;
