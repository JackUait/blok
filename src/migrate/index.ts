/**
 * Public data-migration entry (`@bloklabs/core/migrate`).
 *
 * Promotes Blok's internal legacy→hierarchical expansion — the same transform
 * the renderer runs automatically at load — so consumers can migrate a stored
 * document explicitly (e.g. a one-off batch upgrade of persisted records, or a
 * pre-load normalization step) instead of hand-rolling per-tool shape
 * conversion. The heavy lifting lives in ONE zero-dep grammar module shared
 * verbatim with the standalone codemod, so this surface cannot drift from the
 * runtime auto-migration.
 *
 * Two kinds of rule compose here:
 *
 *   - DATA rules (`migrations`) rewrite one block's `data` in place, and
 *   - GRAMMAR rules (`rules`) restructure the block tree (type changes, 1:N
 *     splits, sibling absorption, container recursion).
 *
 * {@link migrate} runs them in the one correct order — data rules first, so a
 * rule keyed on a legacy type still finds that type to key on — and hosts never
 * have to rediscover the ordering.
 */
import type { OutputBlockData, OutputData } from '../../types';
import { expandToHierarchical } from '../components/utils/data-model-transform';
import {
  analyzeLegacyFormat,
  matchLegacyRule as matchLegacyRuleInGrammar,
} from '../components/migration/legacy-grammar.mjs';
/**
 * The built-in Editor.js→Blok rule table, in match order. Exposed so hosts can
 * introspect coverage (which legacy types migrate, to what, and what each
 * mapping drops) and compose their own entries alongside it.
 */
export { LEGACY_GRAMMAR } from '../components/migration/legacy-grammar.mjs';
import type { LegacyGrammarEntry } from '../components/migration/legacy-grammar.d.mts';
import { migrateBlocks } from '../components/migration/block-migrations';
import type { BlockMigrations } from '../components/migration/block-migrations';
import type { RichText, RichTextEmbed } from '../../types/rich-text';
import { blockDataToSegments, isNestedDocument, legacyNestingFor, nestedDocumentsFor } from '../shared/rich-text/block-data';
import { isRichText } from '../shared/rich-text/guards';
import { LEGACY_BODY_TYPES, LEGACY_ITEM_TYPES, richTextFieldsFor } from '../shared/rich-text/fields';
import { segmentsToHtml } from '../shared/rich-text/segments-to-html';
import { canonicalizeSegments } from '../shared/rich-text/html-to-segments';
import { PAGE_REFERENCE_FALLBACK } from '../shared/page-reference';
import { htmlToSegmentsNode } from '../view/rich-text-parse5';
import { htmlTextContent } from '../view/html-text';

/**
 * Host-supplied per-type block migrations. Lets a host declare "old data shape →
 * new data shape" rules for ANY block type from the outside — the same rules the
 * editor accepts via `config.migrations`, usable here for offline batch upgrades.
 */
export {
  migrateBlocks,
  migrateOutputData,
} from '../components/migration/block-migrations';
export type {
  BlockMigration,
  BlockMigrations,
} from '../components/migration/block-migrations';

export type {
  LegacyGrammarEntry,
  LegacyExpandContext,
  LegacyExpandOptions,
  LegacyExpandPosition,
  LegacyExpansion,
} from '../components/migration/legacy-grammar.d.mts';

/**
 * A field the migration could not carry over, reported as it happens.
 */
export interface LossyFieldReport {
  /** The legacy block type the field came from. */
  blockType: string;
  /** The dropped field's path, e.g. `meta.site_name`. */
  field: string;
  /** Whether the value was `dropped` outright or `ignored` (structure kept). */
  verb: string;
}

/**
 * Environment for a legacy migration pass. Every field is optional; supplying
 * `generateId` is what makes the migration PURE — migrating the same document
 * twice then yields equal output, so a stored document can be compared against
 * its migration and a re-render never mints fresh ids.
 */
export interface LegacyMigrationOptions {
  /** Mint a block id. Defaults to the editor's own (random) generator. */
  generateId?: () => string;
  /** Receive lossy-field reports. Supplying it replaces the `console.warn` default. */
  onLossyField?: (report: LossyFieldReport) => void;
  /** Extra grammar entries, matched BEFORE the built-in table. */
  rules?: LegacyGrammarEntry[];
}

/**
 * Options for a legacy migration, or just the grammar entries.
 *
 * `rules` is an array everywhere it is documented and stored, so handing that
 * array straight to one of these helpers is the obvious call — and silently
 * reading it as "no options" would answer "nothing to migrate", the exact class
 * of quiet wrongness this surface exists to remove. Both forms are accepted.
 */
export type LegacyMigrationArg<T> = T | LegacyGrammarEntry[];

/** Normalize the `options | rules[]` argument into an options object. */
const toOptions = <T extends { rules?: LegacyGrammarEntry[] }>(arg: LegacyMigrationArg<T> | undefined): T => {
  if (Array.isArray(arg)) {
    return { rules: arg } as T;
  }

  return arg ?? ({} as T);
};

/** Build the grammar-facing `warn` from a host's `onLossyField`, if any. */
const toWarnSink = (
  onLossyField: LegacyMigrationOptions['onLossyField']
): ((blockType: string, field: string, verb: string) => void) | undefined => {
  if (onLossyField === undefined) {
    return undefined;
  }

  return (blockType, field, verb) => onLossyField({ blockType, field, verb });
};

/**
 * Migrate legacy / Editor.js-style blocks into Blok's hierarchical
 * flat-with-references format.
 *
 * Legacy nested shapes (list items, toggle/callout children, …) are expanded
 * into separate blocks linked by `parentId`/`content`, and blocks lacking an
 * `id` are stamped with one. Already-hierarchical blocks pass through
 * structurally unchanged, so calling this on current data (or twice) is safe.
 * @param blocks - blocks in any supported legacy or current shape
 * @param options - id generator, lossy-field sink, and host grammar entries
 * @returns blocks in Blok's hierarchical format
 */
export const migrateLegacyBlocks = (
  blocks: OutputBlockData[],
  options?: LegacyMigrationArg<LegacyMigrationOptions>
): OutputBlockData[] => {
  const resolved = toOptions(options);

  return expandToHierarchical(blocks, {
    generateId: resolved.generateId,
    warn: toWarnSink(resolved.onLossyField),
    rules: resolved.rules,
  });
};

/**
 * Migrate a full {@link OutputData} envelope, preserving `time`/`version` and
 * replacing `blocks` with their migrated form. Convenience wrapper around
 * {@link migrateLegacyBlocks} for consumers holding a saved document.
 * @param data - a stored OutputData document
 * @param options - id generator, lossy-field sink, and host grammar entries
 * @returns the document with migrated blocks
 */
export const migrateLegacyOutputData = (
  data: OutputData,
  options?: LegacyMigrationArg<LegacyMigrationOptions>
): OutputData => {
  return {
    ...data,
    blocks: migrateLegacyBlocks(data.blocks, options),
  };
};

/**
 * Report whether a block array contains any legacy shape (a non-hierarchical
 * block or legacy nesting) that {@link migrateLegacyBlocks} would rewrite.
 * Lets consumers skip the migration pass — and its id-minting — when a document
 * is already current.
 * @param blocks - blocks to inspect
 * @param options - host grammar entries to consider alongside the built-ins
 * @returns true if migration would change the structure
 */
export const needsLegacyMigration = (
  blocks: OutputBlockData[],
  options?: LegacyMigrationArg<Pick<LegacyMigrationOptions, 'rules'>>
): boolean => {
  const analysis = analyzeLegacyFormat(blocks, toOptions(options).rules);

  return analysis.hasLegacyBlocks || analysis.hasNesting;
};

/**
 * Which grammar entry (if any) claims a SINGLE block — the per-block primitive
 * behind {@link needsLegacyMigration}. Use it to dispatch per block (logging,
 * reporting, routing) without allocating a throwaway array and re-scanning the
 * whole grammar for every block.
 * @param block - the block to match
 * @param options - host grammar entries to consider alongside the built-ins
 * @returns the matching entry, or `null` when no rule claims the block
 */
export const matchLegacyRule = (
  block: OutputBlockData,
  options?: LegacyMigrationArg<Pick<LegacyMigrationOptions, 'rules'>>
): LegacyGrammarEntry | null => {
  return matchLegacyRuleInGrammar(block, toOptions(options).rules);
};

/**
 * Everything a migration pass could not carry over, plus the rules that failed.
 */
export interface MigrationReport {
  /** Fields with no Blok equivalent, in the order they were encountered. */
  lossyFields: LossyFieldReport[];
  /** Data rules that threw; the affected block kept its stored data. */
  errors: Array<{ type: string; error: unknown }>;
}

/** The result of {@link migrate}: the migrated document plus what it cost. */
export interface MigrationResult {
  data: OutputData;
  report: MigrationReport;
}

/** Options for the composed {@link migrate} entry point. */
export interface MigrateOptions extends LegacyMigrationOptions {
  /** Per-type "old data shape → new data shape" rules (same map as `config.migrations`). */
  migrations?: BlockMigrations;
}

/**
 * Migrate a stored document through BOTH passes in the one correct order, and
 * report what the migration cost.
 *
 * The ordering is load-bearing: host data rules run FIRST because they are keyed
 * by BLOCK TYPE, and the grammar rewrites types (`linkTool` → `bookmark`) and
 * explodes containers into many blocks. Run them the other way round and a rule
 * keyed on a legacy type never fires at all — the type it named no longer
 * exists — and the block stays silently unmigrated.
 *
 * So the two passes divide cleanly: data rules shape the grammar's INPUT (e.g.
 * repairing a legacy field so a built-in rule can detect it), and the grammar
 * owns the OUTPUT for the types it rewrites — fields with no slot in the target
 * shape are not merged through.
 * @param data - a stored OutputData document
 * @param options - data rules, grammar rules, id generator, lossy-field sink
 * @returns the migrated document and a report of dropped fields / failed rules
 */
export const migrate = (
  data: OutputData,
  options?: LegacyMigrationArg<MigrateOptions>
): MigrationResult => {
  const resolved = toOptions(options);
  const lossyFields: LossyFieldReport[] = [];
  const errors: Array<{ type: string; error: unknown }> = [];

  // Pass 1 — host data rules, on the original sibling layout.
  const withHostData = resolved.migrations !== undefined
    ? migrateBlocks(data.blocks, resolved.migrations, (type, error) => errors.push({ type, error }))
    : data.blocks;

  // Pass 2 — the legacy grammar, which is what actually restructures the tree.
  const blocks = migrateLegacyBlocks(withHostData, {
    generateId: resolved.generateId,
    rules: resolved.rules,
    onLossyField: (report) => {
      lossyFields.push(report);
      resolved.onLossyField?.(report);
    },
  });

  return {
    data: { ...data, blocks },
    report: { lossyFields, errors },
  };
};

/** What {@link migrateToRichText} could not convert cleanly: markup with no plain mark. */
export interface RichTextLossyReport {
  blockId?: string;
  blockType: string;
  /** The field, or `'items'` for legacy list item text. */
  field: string;
  /** `html-embed`: markup kept verbatim. `custom-mark`: an unknown tag kept as a `tag:*` mark. */
  reason: 'html-embed' | 'custom-mark';
}

export interface MigrateToRichTextOptions {
  onLossy?: (report: RichTextLossyReport) => void;
}

const lossyReasons = (rich: RichText): Set<RichTextLossyReport['reason']> => {
  const reasons = new Set<RichTextLossyReport['reason']>();

  for (const segment of rich) {
    if ('embed' in segment && 'html' in segment.embed) {
      reasons.add('html-embed');
    }
    if (Object.keys(segment.marks ?? {}).some(key => key.startsWith('tag:'))) {
      reasons.add('custom-mark');
    }
  }

  return reasons;
};

type LossySink = (report: RichTextLossyReport) => void;

/** database-row: a richText property is a whole nested document. */
const convertProperties = (properties: unknown, onLossy: LossySink): unknown => {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return properties;
  }

  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    isNestedDocument(value) ? { ...value, blocks: convertBlocks(value.blocks, onLossy) } : value,
  ]));
};

const convertBlock = (block: OutputBlockData, onLossy: LossySink): OutputBlockData => {
  const data: Record<string, unknown> = block.data ?? {};
  // Legacy fields too (toggleList.title, quote.caption, …): the grammar in migrate() passes arrays through.
  const fields = richTextFieldsFor(block.type);
  // A copy: the writes below must not reach the caller's document.
  const next = { ...blockDataToSegments(data, fields, () => [], htmlToSegmentsNode) };
  const report = (field: string) => (rich: RichText): void =>
    lossyReasons(rich).forEach(reason => onLossy({ blockId: block.id, blockType: block.type, field, reason }));

  for (const field of fields) {
    const value = next[field];

    if (typeof data[field] === 'string' && isRichText(value)) {
      report(field)(value);
    }
  }

  if (nestedDocumentsFor(block.type).nestedDocuments === true && 'properties' in next) {
    next.properties = convertProperties(next.properties, onLossy);
  }

  if (LEGACY_BODY_TYPES.has(block.type) && isNestedDocument(next.body)) {
    next.body = { ...next.body, blocks: convertBlocks(next.body.blocks, onLossy) };
  }

  if (LEGACY_ITEM_TYPES.has(block.type) && Array.isArray(next.items)) {
    const readItem = (html: string): RichText => {
      const rich = htmlToSegmentsNode(html);

      report('items')(rich);

      return rich;
    };

    return { ...block, data: blockDataToSegments(next, [], () => [], readItem, legacyNestingFor(block.type)) };
  }

  return { ...block, data: next };
};

const convertBlocks = (blocks: OutputBlockData[], onLossy: LossySink): OutputBlockData[] =>
  blocks.map(block => convertBlock(block, onLossy));

/**
 * Convert the HTML rich-text fields of a stored document to segments, without a DOM.
 * Only built-in block types are converted, legacy Editor.js shapes included
 * (list items, toggleList/callout titles and bodies, quote captions, warnings);
 * {@link migrate} reads the result either before or after. Table string cells,
 * `raw.html` and `attaches.title` stay strings. Fields that already hold
 * segments pass through.
 * @param data - a stored OutputData document
 * @param options - `onLossy` hears about markup kept as an embed or a custom mark
 * @returns the document with segment fields
 */
export const migrateToRichText = (data: OutputData, options?: MigrateToRichTextOptions): OutputData => ({
  ...data,
  blocks: convertBlocks(data.blocks, options?.onLossy ?? (() => undefined)),
});

/**
 * Canonical HTML for segments. The editor can save a different string for the
 * same segments: on render it maps a raw colour to the nearest preset and can
 * add `target` and `rel` to a link.
 *
 * Not sanitized: a `tag:*` mark, an `html` embed or a link keeps any attribute
 * or URL it holds. To display untrusted content, use `blocksToHtml` from
 * `@bloklabs/core/view`, which sanitizes.
 * @param rich - segments
 */
export const richTextToHtml = (rich: RichText): string => segmentsToHtml(rich);

const embedText = (embed: RichTextEmbed): string => {
  if ('equation' in embed) {
    return embed.equation.expression;
  }
  if ('page' in embed) {
    return PAGE_REFERENCE_FALLBACK;
  }

  return htmlTextContent(embed.html);
};

/**
 * Plain text of segments. Line breaks stay `\n`.
 * @param rich - segments
 */
export const richTextToPlainText = (rich: RichText): string =>
  canonicalizeSegments(rich).map(segment => ('embed' in segment ? embedText(segment.embed) : segment.text)).join('');
