import type { BlockId, BlockToolData, OutputBlockData, SanitizerConfig } from '../../../types';
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
   */
  public render(blocksData: OutputBlockData[]): Promise<void> {
    const { wrapper } = this.Blok.UI.nodes;

    /**
     * Flip the render-readiness gate off synchronously: while a (re-)render is
     * in flight the previously rendered content may already be cleared.
     */
    wrapper.removeAttribute(DATA_ATTR.rendered);

    return new Promise((resolve) => {
      const renderedCount = this.insertRenderedBlocks(blocksData);

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
   */
  private insertRenderedBlocks(blocksData: OutputBlockData[]): number {
    const { Tools, BlockManager } = this.Blok;

    // Give consumers a chance to transform the blocks array before anything is
    // rendered — e.g. to run app-specific legacy-data migrations inside Blok.
    // Runs on the raw saved shape (before format analysis / hierarchical
    // expansion) so the hook sees exactly what was passed to render().
    const sourceBlocks = this.config.onBeforeRender !== undefined
      ? this.config.onBeforeRender(blocksData)
      : blocksData;

    if (sourceBlocks.length === 0) {
      BlockManager.insert();

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
    BlockManager.insertMany(blocks);
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
      this.config.sanitizer as SanitizerConfig
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
