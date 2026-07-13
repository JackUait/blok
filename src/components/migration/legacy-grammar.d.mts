/**
 * Hand-authored types for the zero-dependency legacy migration grammar
 * (`legacy-grammar.mjs`). Co-located in `src/` — the published-types-no-src law
 * only constrains files under `types/`.
 */
import type { OutputBlockData } from '../../../types';

/**
 * Environment injected into every grammar `expand()` so the transforms stay
 * pure. The runtime supplies nanoid ids + a deduping `console.warn`; the codemod
 * supplies locally-minted ids + a no-op warn.
 */
export interface LegacyExpandContext {
  generateId(): string;
  warn?(blockType: string, field: string, verb: 'dropped' | 'ignored'): void;
  /**
   * Whether to mint an id for passthrough (non-migrated) blocks that lack one.
   * Defaults to `true` (runtime requires ids); the codemod passes `false` to
   * keep untouched blocks byte-identical.
   */
  stampMissingIds?: boolean;
}

export interface LegacyGrammarEntry {
  legacyType: string;
  targetType: string;
  cardinality: '1:1' | '1:N';
  contributesNesting: boolean;
  lossyFields: string[];
  docNote: string;
  detect(block: OutputBlockData): boolean;
  expand(block: OutputBlockData, ctx: Required<LegacyExpandContext>): OutputBlockData[];
}

export interface LegacyFormatAnalysis {
  hasLegacyBlocks: boolean;
  hasNesting: boolean;
}

export const LEGACY_GRAMMAR: LegacyGrammarEntry[];

export function expandLegacyBlocks(
  blocks: OutputBlockData[],
  ctx: LegacyExpandContext
): OutputBlockData[];

export function analyzeLegacyFormat(blocks: OutputBlockData[]): LegacyFormatAnalysis;

export function hasLegacyBlocks(blocks: OutputBlockData[]): boolean;

export function hasLegacyNesting(blocks: OutputBlockData[]): boolean;

export function createBlockIdGenerator(): () => string;

export const BLOCK_ID_ALPHABET: string;
export const BLOCK_ID_LENGTH: number;
export const VARIANT_TO_BG_PRESET: Record<string, string | null>;
export const CALLOUT_DEFAULT_EMOJI: string;
export const WARNING_EMOJI: string;
