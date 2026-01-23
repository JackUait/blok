import type { BlockId, BlockToolData, OutputBlockData } from '../../../types';
import type { StubData } from '../../tools/stub';
import { Module } from '../__module';
import type { Block } from '../block';
import type { BlockToolAdapter } from '../tools/block';
import { log, logLabeled } from '../utils';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
  type DataFormatAnalysis,
} from '../utils/data-model-transform';

/**
 * Module that responsible for rendering Blocks on blok initialization
 */
export class Renderer extends Module {
  /**
   * Stores the detected input data format for use during save
   */
  private detectedInputFormat: DataFormatAnalysis['format'] = 'flat';

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
    return new Promise((resolve) => {
      const { Tools, BlockManager } = this.Blok;

      if (blocksData.length === 0) {
        BlockManager.insert();
      } else {
        // Analyze and potentially transform the input data
        const dataModelConfig = this.config.dataModel || 'auto';
        const analysis = analyzeDataFormat(blocksData);
        this.detectedInputFormat = analysis.format;

        // Transform to hierarchical if config requires it
        const processedBlocks = shouldExpandToHierarchical(dataModelConfig, analysis.format)
          ? expandToHierarchical(blocksData)
          : blocksData;

        // Note: Yjs data layer is loaded via BlockManager.insertMany() with the correct block IDs

        /**
         * Create Blocks instances
         */
        const blocks = processedBlocks.map((blockData: OutputBlockData) => {
          const { tunes, id, parent, content } = blockData;
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
              });
            }
          };

          return buildBlock(availabilityResult.tool, availabilityResult.data);
        });

        /**
         * Insert batch of Blocks
         */
        BlockManager.insertMany(blocks);
      }

      /**
       * Wait till browser will render inserted Blocks and resolve a promise
       */
      window.requestIdleCallback(() => {
        resolve();
      }, { timeout: 2000 });
    });
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
