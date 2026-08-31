import type { BlockId, BlockToolData, OutputBlockData } from '../../../types';
import type { StubData } from '../../tools/stub';
import { Module } from '../__module';
import type { Block } from '../block';
import type { BlockToolAdapter } from '../tools/block';
import { generateBlockId, log, logLabeled } from '../utils';
import { sanitizeBlocks, stripUnsafeUrlsDeep } from '../utils/sanitizer';
import {
  analyzeDataFormat,
  expandToHierarchical,
  normalizeTableChildParents,
  reclaimDetachedTableCells,
  shouldExpandToHierarchical,
  type DataFormatAnalysis,
} from '../utils/data-model-transform';
import { migrateMarkColors } from '../utils/color-migration';
import { migrateBlocks } from '../migration/block-migrations';
import { applyLinkConfig } from '../utils/apply-link-config';
import { DATA_ATTR } from '../constants';
import { BlocksRendered } from '../events';

/**
 * Map of legacy EditorJS tool names to their Blok equivalents.
 * Used during rendering to transparently migrate old article data.
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  delimiter: 'divider',
};

/**
 * Module that responsible for rendering Blocks on blok initialization
 */
export class Renderer extends Module {
  /**
   * Stores the detected input data format for use during save
   */
  private detectedInputFormat: DataFormatAnalysis['format'] = 'flat';

  /**
   * Promise that resolves when an in-progress render operation completes.
   * Used by Saver to wait for render to finish before reading blocks.
   * null when no render is in progress.
   */
  public pendingRender: Promise<void> | null = null;

  /**
   * Decoded URL hash fragment that could not be scrolled to at init time
   * because the target block was not yet in the DOM.
   * Set by Blok constructor; consumed (and cleared) by BlocksAPI.render().
   */
  public pendingHashScroll: string | null = null;

  /**
   * Resolve function for the current pendingRender promise.
   * Called when the render operation is done (in finally block).
   */
  private resolvePendingRender: (() => void) | null = null;

  /**
   * Signals that a render operation is starting.
   * Sets pendingRender so that Saver can await it.
   */
  public markRenderStart(): void {
    this.pendingRender = new Promise<void>((resolve) => {
      this.resolvePendingRender = resolve;
    });
  }

  /**
   * Signals that a render operation has completed.
   * Resolves pendingRender so that any waiting Saver call can proceed.
   */
  public markRenderEnd(): void {
    if (this.resolvePendingRender !== null) {
      this.resolvePendingRender();
      this.resolvePendingRender = null;
    }
    this.pendingRender = null;
  }

  /**
   * Get the detected input format
   */
  public getDetectedInputFormat(): DataFormatAnalysis['format'] {
    return this.detectedInputFormat;
  }

  /**
   * Renders passed blocks as one batch
   * @param blocksData - blocks to render
   * @param options - render behaviour
   * @param options.skipYjsSync - rebuild the view only, leaving the Yjs
   *   document (and with it the undo history) exactly as it is. Used when the
   *   blocks being rendered are the ones already in the document and only
   *   their DOM has to be produced again — see `repaintBlocks`.
   */
  public render(blocksData: OutputBlockData[], options: { skipYjsSync?: boolean } = {}): Promise<void> {
    const { wrapper } = this.Blok.UI.nodes;

    /**
     * Flip the render-readiness gate off synchronously: while a (re-)render is
     * in flight the previously rendered content may already be cleared.
     */
    wrapper.removeAttribute(DATA_ATTR.rendered);

    return new Promise((resolve) => {
      const renderedCount = this.insertRenderedBlocks(blocksData, options);

      /**
       * Wait till browser will render inserted Blocks and resolve a promise
       */
      window.requestIdleCallback(() => {
        wrapper.setAttribute(DATA_ATTR.rendered, '');
        this.eventsDispatcher.emit(BlocksRendered, { count: renderedCount });
        this.config.onAfterRender?.(this.Blok.API.methods);
        resolve();
      }, { timeout: 2000 });
    });
  }

  /**
   * Inserts the given blocks (or a single default block when the input is
   * empty) and returns the number of top-level blocks rendered in this batch.
   * @param blocksData - blocks to render
   * @param options - render behaviour
   * @param options.skipYjsSync - see `render`
   */
  private insertRenderedBlocks(blocksData: OutputBlockData[], options: { skipYjsSync?: boolean } = {}): number {
    const { Tools, BlockManager } = this.Blok;

    const inputBlocks = this.resolveRenderSource(blocksData, options);

    // Give consumers a chance to transform the blocks array before anything is
    // rendered — e.g. to run app-specific legacy-data migrations inside Blok.
    // Runs on the raw saved shape (before format analysis / hierarchical
    // expansion) so the hook sees exactly what was passed to render().
    const hookedBlocks = this.config.onBeforeRender !== undefined
      ? this.config.onBeforeRender(inputBlocks)
      : inputBlocks;

    // Host-supplied per-type data migrations (`config.migrations`) run HERE —
    // before format analysis — so `dataModel: 'auto'` inspects the POST-migration
    // shape. Applying them later (at composeBlock time) let 'auto' detect the
    // pre-migration legacy format and collapse the document back to that shape on
    // save, quietly undoing the migration. Rules are contractually pure and
    // idempotent, so the composeBlock pass (which also covers blocks inserted
    // through the API later) can safely see already-migrated data.
    const sourceBlocks = this.config.migrations !== undefined
      ? migrateBlocks(hookedBlocks, this.config.migrations, (type, error) => {
        logLabeled(`Migration for «${type}» blocks failed; keeping stored data.`, 'warn', error);
      })
      : hookedBlocks;

    if (sourceBlocks.length === 0) {
      /**
       * Under collaboration the document — not this call — owns the floor.
       *
       * The insert below writes to the Yjs document (`BlockManager.insert`
       * has no `skipYjsSync` here, and forwarding one would only trade the
       * write for a DOM-only block whose typing is silently dropped), and the
       * id it generates is RANDOM. Every peer running a view rebuild against
       * an empty document would author its own paragraph, they would all
       * converge, and a room would end up with one paragraph per peer.
       *
       * Collaboration seeds the first block itself, once, with an id derived
       * from the document id so a race lands ONE paragraph — see
       * `seedEmptyDocument`. Leaving the editor with no blocks here is what
       * lets that run: its guard is the document still being empty.
       */
      if (this.Blok.Collaboration?.isEnabled ?? false) {
        return 0;
      }

      // Still a document render, not an authoring gesture: the default block is
      // what an empty document IS, so a container tool must not treat it as
      // "the author just made me".
      BlockManager.insert({ origin: 'load' });

      return 1;
    }

    // Analyze and potentially transform the input data
    const dataModelConfig = this.config.dataModel || 'auto';
    const analysis = analyzeDataFormat(sourceBlocks);
    this.detectedInputFormat = analysis.format;

    // Transform to hierarchical if config requires it
    const expandedBlocks = shouldExpandToHierarchical(dataModelConfig, analysis.format)
      ? expandToHierarchical(sourceBlocks)
      : sourceBlocks;

    // Recover migrated cells whose text a pre-fix save detached to root:
    // re-attach `cell-<row>-<col>`-id orphans back into their empty cell.
    // Runs before normalize so reclaimed refs get parented in the same pass.
    const reclaimedBlocks = reclaimDetachedTableCells(expandedBlocks);

    // Tables persist child references via `data.content[r][c].blocks = [<id>]`
    // rather than an explicit `parent` field on each child. Pre-normalize
    // those parent references so downstream code that gates on parentId
    // (read-only cell mounter, saver filter, hierarchy queries) correctly
    // recognizes the children as belonging to their table.
    const processedBlocks = normalizeTableChildParents(reclaimedBlocks);

    // Note: Yjs data layer is loaded via BlockManager.insertMany() with the correct block IDs

    /**
     * Track seen IDs to detect and resolve duplicates
     */
    const seenIds = new Set<string>();

    /**
     * Create Blocks instances
     */
    const blocks = processedBlocks.map((blockData: OutputBlockData) => {
      const { tunes, parent, content, lastEditedAt, lastEditedBy } = blockData;
      // Wire DTOs may carry `id: null` — normalize to undefined so the block
      // factory generates a fresh id and null ids never collide as "duplicates".
      const incomingId = blockData.id ?? undefined;
      const hasDuplicateId = incomingId !== undefined && seenIds.has(incomingId);

      if (hasDuplicateId) {
        logLabeled(`Duplicate block id «${incomingId}» replaced with a generated id to ensure uniqueness`, 'warn');
      }

      const id = hasDuplicateId ? generateBlockId() : incomingId;

      if (id !== undefined) {
        seenIds.add(id);
      }
      const originalTool = blockData.type;

      /**
       * Validate that block data has the expected shape.
       * Since OutputBlockData<Data> defaults to `any` for Data, we need to narrow the type.
       */
      const isValidBlockData = (data: unknown): data is Record<string, unknown> => {
        return typeof data === 'object' && data !== null;
      };

      const blockToolData = isValidBlockData(blockData.data) ? blockData.data : {};

      const availabilityResult = (() => {
        if (Tools.available.has(originalTool)) {
          return {
            tool: originalTool,
            data: blockToolData,
          };
        }

        const aliasTarget = TOOL_ALIASES[originalTool];

        if (aliasTarget !== undefined && Tools.available.has(aliasTarget)) {
          return {
            tool: aliasTarget,
            data: blockToolData,
          };
        }

        logLabeled(`Tool «${originalTool}» is not found. Check 'tools' property at the Blok config.`, 'warn');

        return {
          tool: Tools.stubTool,
          data: this.composeStubDataForTool(originalTool, blockToolData, id),
        };
      })();

      const buildBlock = (tool: string, data: BlockToolData): Block => {
        try {
          return BlockManager.composeBlock({
            id,
            tool,
            data,
            tunes,
            parentId: parent,
            contentIds: content,
            lastEditedAt,
            lastEditedBy,
            // Restoring a stored document: whatever children the data declares
            // are authoritative, so container tools must not seed defaults.
            origin: 'load',
          });
        } catch (error) {
          log(`Block «${tool}» skipped because of plugins error`, 'error', {
            data,
            error,
          });

          /**
           * If tool throws an error during render, we should render stub instead of it
           */
          const stubData = this.composeStubDataForTool(tool, data, id);

          return BlockManager.composeBlock({
            id,
            tool: Tools.stubTool,
            data: stubData,
            tunes,
            parentId: parent,
            contentIds: content,
            lastEditedAt,
            lastEditedBy,
            origin: 'load',
          });
        }
      };

      /**
       * Stored data is untrusted: it may come from a legacy editor, an older
       * tool version, or hand-edited JSON that never round-tripped through
       * save(). Apply the same tool sanitize config the Saver applies, so
       * markup disallowed at save time (e.g. a raw <iframe> inside paragraph
       * text) can never reach a tool's innerHTML sink at render time.
       * Stub blocks are skipped — their data wraps the original payload for
       * restoring once the missing tool is registered.
       */
      const renderData = availabilityResult.tool === Tools.stubTool
        ? availabilityResult.data
        : this.sanitizeToolData(availabilityResult.tool, availabilityResult.data);

      return buildBlock(availabilityResult.tool, renderData);
    });

    /**
     * Insert batch of Blocks
     */
    BlockManager.insertMany(blocks, 0, { skipYjsSync: options.skipYjsSync === true });
    migrateMarkColors(this.Blok.UI.nodes.redactor);

    // Apply the editor's `link` config (target / rel / transformHref) to every
    // anchor coming from stored block HTML, mirroring the interactive Link
    // inline tool. Without this, link config only governs links the user
    // creates by hand — anchors from saved articles keep their stored attrs.
    if (this.config.link !== undefined) {
      applyLinkConfig(this.Blok.UI.nodes.redactor, this.config.link);
    }

    return blocks.length;
  }

  /**
   * What a render call actually renders.
   *
   * Ordinary renders render the caller's blocks. A COLLABORATION VIEW REBUILD —
   * `skipYjsSync`, which under collaboration is the only kind of render there
   * is (`blocks.render()` is refused, and the boot render never runs) — renders
   * the Yjs document instead, whenever the document holds anything. The shared
   * document is the authority; the caller's array is a local snapshot that is
   * wrong in two ways this costs nothing to avoid:
   *
   * - It comes from `Saver.save()`, which DROPS a block whose `validate()`
   *   rejects it. The one block a fresh room is seeded with is an empty
   *   paragraph, so the first read-only transition in a brand-new room saved
   *   `[]` and blanked an editor whose document had content.
   * - It is captured before an `await`, so a lineage reset landing mid-rebuild
   *   re-rendered the PRE-RESET blocks into the fresh document.
   *
   * The one exemption is the degraded view: while `config.data` is on screen as
   * "here is what we last saw", the document is empty ON PURPOSE — the session
   * has never synced — and the blocks the caller passed are the only content
   * there is.
   *
   * Rendering the document costs nothing when the two agree: the blocks keep
   * their ids, and `skipYjsSync` means nothing is written back.
   * @param blocksData - blocks the caller asked to render
   * @param options - render behaviour
   * @param options.skipYjsSync - see `render`
   */
  private resolveRenderSource(
    blocksData: OutputBlockData[],
    options: { skipYjsSync?: boolean }
  ): OutputBlockData[] {
    const collaboration = this.Blok.Collaboration;
    const isCollaborating = collaboration?.isEnabled ?? false;
    const isShowingLastKnown = collaboration?.isDegraded ?? false;

    if (options.skipYjsSync !== true || !isCollaborating || isShowingLastKnown) {
      return blocksData;
    }

    return this.Blok.YjsManager.toJSON();
  }

  /**
   * Clean stored block data with the tool's sanitize config (plus the global
   * sanitizer) before it reaches the tool's render sink — mirror of the
   * Saver's sanitizeExtractedData pass. Tools without a sanitize config keep
   * their markup unchanged (same as on save), but still get the unconditional
   * URL-scheme safety pass.
   * @param tool - resolved tool name the block will be rendered with
   * @param data - stored block data
   */
  private sanitizeToolData(tool: string, data: BlockToolData): BlockToolData {
    const { Tools } = this.Blok;

    const [sanitized] = sanitizeBlocks(
      [{ tool, data }],
      (name) => Tools.blockTools.get(name)?.sanitizeConfig,
      this.config.sanitizer
    );

    // URL-scheme safety must not depend on the tool declaring a sanitize
    // config: run the scheme-only pass unconditionally (tag allowlisting
    // stays opt-in per tool). Also rebuilds the data containers, so stored
    // caller-owned objects are never retained by reference.
    return stripUnsafeUrlsDeep(sanitized.data, Tools.blockTools.get(tool)?.sanitizeConfig);
  }

  /**
   * Create data for the Stub Tool that will be used instead of unavailable tool
   * @param tool - unavailable tool name to stub
   * @param data - data of unavailable block
   * @param [id] - id of unavailable block
   */
  private composeStubDataForTool(tool: string, data: BlockToolData, id?: BlockId): StubData {
    const { Tools } = this.Blok;

    const title = (() => {
      if (!Tools.unavailable.has(tool)) {
        return tool;
      }

      const toolboxSettings = (Tools.unavailable.get(tool) as BlockToolAdapter).toolbox;

      if (toolboxSettings !== undefined && toolboxSettings[0].title !== undefined) {
        return toolboxSettings[0].title;
      }

      return tool;
    })();

    return {
      savedData: {
        id,
        type: tool,
        data,
      },
      title,
    };
  }
}
