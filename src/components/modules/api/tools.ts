import type { Tools as ToolsAPIInterface } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * Provides methods for accessing installed Blok tools
 */
export class ToolsAPI extends Module {
  /**
   * Available methods
   */
  public get methods(): ToolsAPIInterface {
    return {
      getBlockTools: () => Array.from(this.Blok.Tools.blockTools.values()),
      getToolsConfig: () => {
        const result: ReturnType<ToolsAPIInterface['getToolsConfig']> = {
          tools: this.config.tools,
        };

        if (this.config.inlineToolbar !== undefined) {
          result.inlineToolbar = this.config.inlineToolbar;
        }

        if (this.config.tunes !== undefined) {
          result.tunes = this.config.tunes;
        }

        return result;
      },
    };
  }
}
