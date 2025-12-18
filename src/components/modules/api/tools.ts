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
    };
  }
}
