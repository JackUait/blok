import { InlineTool as IInlineTool, InlineTool } from '../..';
import { BaseToolAdapter } from './base-tool-adapter';
import { ToolType } from './tool-type';

interface InlineToolAdapter extends BaseToolAdapter<ToolType.Inline, InlineTool> {
  /**
   * Constructs new InlineTool instance from constructable
   */
  create(): IInlineTool;
}
