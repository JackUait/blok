import { InlineTool as IInlineTool, InlineTool } from '../..';
import { BaseToolAdapter } from './base-tool-adapter';
import { ToolType } from './tool-type';

interface InlineToolAdapter extends BaseToolAdapter<ToolType.Inline, InlineTool> {
  /**
   * Constructs new InlineTool instance from constructable
   */
  create(): IInlineTool;

  /**
   * Returns the tool title
   */
  title: string;

  /**
   * Returns the translation key for the tool title
   */
  titleKey: string | undefined;

  /**
   * Whether the tool's shortcut may open its menu at a collapsed caret.
   */
  allowCaretShortcut: boolean;

  /**
   * Whether the tool's shortcut defers to native browser handling at a
   * collapsed caret (Bold, Italic).
   */
  nativeCaretShortcut: boolean;
}
