/**
 * Public type surface for the `@bloklabs/core/migrate` entry.
 *
 * Hand-authored and self-contained per the published-types-no-src law: it may
 * reference other files under `types/` but never anything under `src/`.
 */
import { OutputBlockData, OutputData } from './data-formats/output-data';
import { BlockToolData } from './tools/block-tool-data';

/**
 * A single "old data shape → new data shape" rule for one block type.
 *
 * Must be a pure function of `data`: return the upgraded data, or the input
 * unchanged (or `undefined`) when it is already current — so it stays safe to
 * run on every load and idempotent across repeated runs. Unlike a Tool's
 * `upgradeData`, this rule lives OUTSIDE the tool class, so a host can migrate a
 * third-party tool it doesn't own, or its own tool without editing the class.
 * @param data - the stored block data (any shape ever written for this type)
 * @returns the data in the current shape (or the input when already current)
 */
export type BlockMigration = (data: BlockToolData) => BlockToolData | undefined | null;

/**
 * A map of block-type name → migration rule, keyed by the block `type` (tool
 * name). Supply it via editor config (`migrations`) to apply at load, or pass
 * it to {@link migrateBlocks} / {@link migrateOutputData} for a batch upgrade.
 */
export type BlockMigrations = Record<string, BlockMigration>;

/**
 * Apply host-supplied migrations across a block array, matching each block by
 * its `type`. Blocks with no matching rule pass through unchanged; envelope
 * fields (`id`, `type`, `tunes`, …) are preserved. A rule that throws is caught
 * and that block keeps its stored data.
 * @param blocks - blocks in Blok's output shape
 * @param migrations - the host's per-type migration map
 * @param onError - optional reporter for a rule that threw
 * @returns the blocks with migrated `data`
 */
export declare function migrateBlocks(
  blocks: OutputBlockData[],
  migrations: BlockMigrations,
  onError?: (type: string, error: unknown) => void
): OutputBlockData[];

/**
 * Apply host-supplied migrations to a full OutputData envelope, preserving
 * `time`/`version` and replacing `blocks` with their migrated form — e.g. a
 * one-off batch upgrade of persisted records, without opening an editor.
 * @param data - a stored OutputData document
 * @param migrations - the host's per-type migration map
 * @returns the document with migrated blocks
 */
export declare function migrateOutputData(data: OutputData, migrations: BlockMigrations): OutputData;

/**
 * What every grammar expander RECEIVES, so each transform stays a pure function
 * of `(block, ctx, position)`. Every field is present — the interpreter fills in
 * the caller's omissions — so an expander can call `ctx.warn(...)` unguarded.
 */
export interface LegacyExpandContext {
  /** Mint a fresh block id. */
  generateId(): string;
  /** Report a field the mapping could not carry over; it reaches `report.lossyFields`. */
  warn(blockType: string, field: string, verb: 'dropped' | 'ignored'): void;
  /** Whether passthrough (non-migrated) blocks lacking an id get one stamped. */
  stampMissingIds: boolean;
}

/**
 * Where the expanded block sits in the array being expanded. Lets an expander
 * absorb following siblings — the shape flat-with-count legacy formats need (a
 * container storing its body as "the next N blocks").
 */
export interface LegacyExpandPosition {
  /** The array the block belongs to (a document, or a container's body). */
  siblings: OutputBlockData[];
  /** The expanded block's index within `siblings`. */
  index: number;
}

/**
 * An expander's return value when it absorbed following siblings. `consumed` is
 * clamped to what actually remains, so a truncated document can never
 * over-consume.
 */
export interface LegacyExpansion {
  /** The blocks this rule produced (the container plus any children). */
  blocks: OutputBlockData[];
  /** How many FOLLOWING siblings the rule absorbed. */
  consumed: number;
}

/**
 * One legacy-format rule: how to recognize a legacy block shape and what to turn
 * it into. The built-in Editor.js coverage is a table of these; supplying your
 * own through `rules` reuses the whole interpreter — recursion into container
 * bodies, the orphan re-parenting invariant, 1:N splits, id minting — instead of
 * re-implementing the dispatch loop.
 */
export interface LegacyGrammarEntry {
  /** The legacy block `type` this rule recognizes. */
  legacyType: string;
  /** The Blok block `type` it maps to (informational; used by docs generation). */
  targetType: string;
  /** Whether one legacy block maps to one block or several. */
  cardinality: '1:1' | '1:N';
  /** Whether a match always implies hierarchical structure. */
  contributesNesting: boolean;
  /** Source fields dropped with no Blok equivalent. */
  lossyFields: string[];
  /** Human-readable one-line note for the compatibility matrix. */
  docNote: string;
  /** Whether this rule claims the given block. */
  detect(block: OutputBlockData): boolean;
  /**
   * Per-block nesting test, for rules whose structure depends on the data (a
   * list with nested items, a container with a non-empty body). Falls back to
   * `contributesNesting` when absent.
   */
  detectNesting?(block: OutputBlockData): boolean;
  /**
   * Turn the legacy block into Blok blocks. Return an array, or
   * `{ blocks, consumed }` when the rule absorbed following siblings.
   */
  expand(
    block: OutputBlockData,
    ctx: LegacyExpandContext,
    position: LegacyExpandPosition
  ): OutputBlockData[] | LegacyExpansion;
}

/**
 * A field the migration could not carry over.
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
  /** Extra grammar entries, matched BEFORE the built-in table (so they can override it). */
  rules?: LegacyGrammarEntry[];
}

/**
 * Options for a legacy migration, or just the grammar entries.
 *
 * `rules` is an array everywhere it is documented and stored, so handing that
 * array straight to one of these helpers is the obvious call — and reading it as
 * "no options" would silently answer "nothing to migrate". Both forms work.
 */
export type LegacyMigrationArg<T> = T | LegacyGrammarEntry[];

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
export declare function migrateLegacyBlocks(
  blocks: OutputBlockData[],
  options?: LegacyMigrationArg<LegacyMigrationOptions>
): OutputBlockData[];

/**
 * Migrate a full OutputData envelope, preserving `time`/`version` and replacing
 * `blocks` with their migrated form. Convenience wrapper around
 * {@link migrateLegacyBlocks} for consumers holding a saved document.
 * @param data - a stored OutputData document
 * @param options - id generator, lossy-field sink, and host grammar entries
 * @returns the document with migrated blocks
 */
export declare function migrateLegacyOutputData(
  data: OutputData,
  options?: LegacyMigrationArg<LegacyMigrationOptions>
): OutputData;

/**
 * Report whether a block array contains any legacy shape (a non-hierarchical
 * block or legacy nesting) that {@link migrateLegacyBlocks} would rewrite. Lets
 * consumers skip the migration pass — and its id-minting — when a document is
 * already current.
 * @param blocks - blocks to inspect
 * @param options - host grammar entries to consider alongside the built-ins
 * @returns true if migration would change the structure
 */
export declare function needsLegacyMigration(
  blocks: OutputBlockData[],
  options?: LegacyMigrationArg<Pick<LegacyMigrationOptions, 'rules'>>
): boolean;

/**
 * Which grammar rule (if any) claims a SINGLE block — the per-block primitive
 * behind {@link needsLegacyMigration}. Use it to dispatch per block (logging,
 * reporting, routing) without allocating a throwaway array and re-scanning the
 * whole grammar for every block.
 * @param block - the block to match
 * @param options - host grammar entries to consider alongside the built-ins
 * @returns the matching rule, or `null` when no rule claims the block
 */
export declare function matchLegacyRule(
  block: OutputBlockData,
  options?: LegacyMigrationArg<Pick<LegacyMigrationOptions, 'rules'>>
): LegacyGrammarEntry | null;

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
export declare function migrate(
  data: OutputData,
  options?: LegacyMigrationArg<MigrateOptions>
): MigrationResult;

/**
 * The built-in Editor.js→Blok rule table, in match order. Read it to introspect
 * coverage (which legacy types migrate, to what, and what each mapping drops).
 */
export declare const LEGACY_GRAMMAR: LegacyGrammarEntry[];
