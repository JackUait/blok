import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { HandlerContext, PasteData } from '../types';
import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';
import type { ToolRegistry } from '../tool-registry';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import { Dom } from '../../../dom';

/**
 * Text Handler Priority.
 * Handles plain text that doesn't match other handlers.
 * This is the fallback handler with lowest priority.
 */
export class TextHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    private readonly config: BlokConfig
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    // This is the fallback handler, so it always can handle with lowest priority
    if (typeof data !== 'string') {
      return 0;
    }

    return data.length > 0 ? 10 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const dataToInsert = this.processPlain(data);

    if (!dataToInsert.length) {
      return false;
    }

    await this.insertPasteData(dataToInsert, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Split plain text by new line symbols and return it as array of Block data.
   */
  private processPlain(plain: string): PasteData[] {
    const { defaultBlock } = this.config;

    if (!plain || !defaultBlock) {
      return [];
    }

    return plain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((text) => {
        const content = Dom.make('div');

        content.textContent = text;

        const event = this.composePasteEvent('tag', {
          data: content,
        });

        return {
          content,
          tool: defaultBlock,
          isBlock: false,
          event,
        };
      });
  }
}
