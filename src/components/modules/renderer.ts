import Module from '../__module';
import * as _ from '../utils';
import type { BlockId, BlockToolData, OutputBlockData } from '../../../types';
import type BlockToolAdapter from '../tools/block';
import type { StubData } from '../../tools/stub';
import type Block from '../block';

/**
 * Module that responsible for rendering Blocks on blok initialization
 */
export default class Renderer extends Module {
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
        /**
         * Create Blocks instances
         */
        const blocks = blocksData.map((blockData) => {
          const { tunes, id } = blockData;
          const originalTool = blockData.type;
          const availabilityResult = (() => {
            if (Tools.available.has(originalTool)) {
              return {
                tool: originalTool,
                data: blockData.data,
              };
            }

            _.logLabeled(`Tool «${originalTool}» is not found. Check 'tools' property at the Blok config.`, 'warn');

            return {
              tool: Tools.stubTool,
              data: this.composeStubDataForTool(originalTool, blockData.data, id),
            };
          })();

          const buildBlock = (tool: string, data: BlockToolData): Block => {
            try {
              return BlockManager.composeBlock({
                id,
                tool,
                data,
                tunes,
              });
            } catch (error) {
              _.log(`Block «${tool}» skipped because of plugins error`, 'error', {
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
