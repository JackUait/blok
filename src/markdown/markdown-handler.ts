import type { BlokModules } from '../types-internal/blok-modules';
import { Dom } from '../components/dom';
import type { SanitizerConfigBuilder } from '../components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../components/modules/paste/tool-registry';
import type { HandlerContext, PasteData } from '../components/modules/paste/types';
import type { PasteHandler } from '../components/modules/paste/handlers/base';
import { BasePasteHandler } from '../components/modules/paste/handlers/base';

/**
 * Patterns that indicate text is likely Markdown rather than plain text.
 * Each must be unlikely to appear in normal prose.
 */
const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s/m,                   // ATX headings: # Heading
  /^```/m,                         // Fenced code blocks
  /\|\s*---/,                      // GFM table separator: | --- |
  /^- \[[ x]\]/m,                  // Task list items: - [ ] or - [x]
  /\[.+?\]\(.+?\)/,               // Markdown links: [text](url)
  /\*\*.+?\*\*/,                   // Bold: **text**
  /!\[/,                           // Image: ![
];

/**
 * Check if a plain-text string contains strong Markdown signals.
 */
export function hasMarkdownSignals(text: string): boolean {
  if (!text) {
    return false;
  }

  return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
}

/**
 * Paste handler that detects and converts Markdown text.
 * Priority 30: between TextHandler (10) and HtmlHandler (40).
 * Lazy-loads the converter on first use.
 */
export class MarkdownHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string' || !data.trim()) {
      return 0;
    }

    return hasMarkdownSignals(data) ? 30 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const { markdownToBlocks } = await import('./index');
    const blocks = markdownToBlocks(data);

    if (!blocks.length) {
      return false;
    }

    const pasteData: PasteData[] = blocks.map((block) => {
      const content = Dom.make('div');

      const text = block.data as { text?: string };

      content.innerHTML = typeof text.text === 'string' ? text.text : '';

      const event = this.composePasteEvent('tag', {
        data: content,
      });

      return {
        content,
        tool: block.type,
        isBlock: true,
        event,
      };
    });

    await this.insertPasteData(pasteData, context.canReplaceCurrentBlock);

    return true;
  }
}
