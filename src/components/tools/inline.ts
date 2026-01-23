import { BaseToolAdapter } from './base';

import type { InlineTool as IInlineTool, InlineToolConstructable } from '@/types';
import type { InlineToolAdapter as InlineToolAdapterInterface } from '@/types/tools/adapters/inline-tool-adapter';
import { ToolType } from '@/types/tools/adapters/tool-type';

/**
 * InlineTool object to work with Inline Tools constructables
 */
export class InlineToolAdapter extends BaseToolAdapter<ToolType.Inline, IInlineTool> implements InlineToolAdapterInterface {
  /**
   * Tool type — Inline
   */
  public type: ToolType.Inline = ToolType.Inline;

  /**
   * Returns list of required methods that are missing on the inline tool prototype
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

    const InlineToolClass = this.constructable as InlineToolConstructable;

    return new InlineToolClass({
      api: this.api,
      config: this.settings,
    });
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

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Backward compatibility: title is deprecated but still needs to be supported
    return constructable['title'] || '';
  }

  /**
   * Returns the translation key for the tool title
   */
  public get titleKey(): string | undefined {
    const constructable = this.constructable as InlineToolConstructable;

    return constructable['titleKey'];
  }
}
