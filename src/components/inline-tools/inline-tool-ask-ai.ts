import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import type { API, InlineTool } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconEmojiSparkles } from '../icons';

/**
 * "Ask AI" in the inline toolbar: opens the assistant prompt bar about the
 * selected text. Registered only when `agent.assistant` is configured.
 */
export class AskAiInlineTool implements InlineTool {
  public static describe = BUILT_IN_INLINE_DESCRIPTIONS.askAi;

  public static isInline = true;

  public static title = 'Ask AI';

  public static titleKey = 'askAi';

  private readonly api: API;

  /**
   * @param options - tool options
   * @param options.api - editor API
   */
  constructor({ api }: { api: API }) {
    this.api = api;
  }

  public render(): MenuConfig {
    return {
      icon: IconEmojiSparkles,
      name: 'askAi',
      onActivate: () => {
        // The bar reads the selection before it takes focus.
        this.api.agent?.openAssistant();
        this.api.inlineToolbar.close();
      },
    };
  }
}
