import BaseToolAdapter from './base';
import type { InlineTool as IInlineTool, InlineToolConstructable } from '@/types';
import type { InlineToolAdapter as InlineToolAdapterInterface } from '@/types/tools/adapters/inline-tool-adapter';
import { ToolType } from '@/types/tools/adapters/tool-type';

/**
 * InlineTool object to work with Inline Tools constructables
 */
export default class InlineToolAdapter extends BaseToolAdapter<ToolType.Inline, IInlineTool> implements InlineToolAdapterInterface {
  /**
   * Tool type — Inline
   */
  public type: ToolType.Inline = ToolType.Inline;

  /**
   * Returns list of required methods that are missing on the inline tool prototype
   *
   * @param requiredMethods - method names that must be implemented
   */
  public getMissingMethods(requiredMethods: string[]): string[] {
    const constructable = this.constructable as InlineToolConstructable | undefined;
    const prototype = constructable?.prototype as Record<string, unknown> | undefined;

    if (!prototype) {
      return [ ...requiredMethods ];
    }

    return requiredMethods.filter((methodName) => typeof prototype[methodName] !== 'function');
  }

  /**
   * Constructs new InlineTool instance from constructable
   */
  public create(): IInlineTool {
    // eslint-disable-next-line new-cap
    const InlineToolClass = this.constructable as InlineToolConstructable;

    return new InlineToolClass({
      api: this.api,
      config: this.settings,
    }) as IInlineTool;
  }

  /**
   * Allows inline tool to be available in read-only mode
   * Can be used, for example, by comments tool
   */
  public get isReadOnlySupported(): boolean {
    const constructable = this.constructable as InlineToolConstructable | undefined;

    return constructable?.isReadOnlySupported ?? false;
  }

  /**
   * Returns title of the tool
   */
  public get title(): string {
    const constructable = this.constructable as InlineToolConstructable;

    return constructable['title'] || '';
  }
}
