import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PatternMatch } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/**
 * Pattern Handler Priority.
 * Checks if data matches tool patterns.
 */
export class PatternHandler extends BasePasteHandler implements PasteHandler {
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    const text = data;

    if (!text || text.length > PatternHandler.PATTERN_PROCESSING_MAX_LENGTH) {
      return 0;
    }

    const pattern = this.toolRegistry.findToolForPattern(text);

    return pattern ? 60 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const pattern = this.toolRegistry.findToolForPattern(data);

    if (!pattern) {
      return false;
    }

    const event = this.composePasteEvent('pattern', {
      key: pattern.key,
      data: data,
    });

    const match: PatternMatch = {
      key: pattern.key,
      data: data,
      tool: pattern.tool.name,
      event,
    };

    await this.insertPatternBlock(match, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Insert pattern block.
   * Public method for other handlers to call.
   */
  async insertPatternBlock(match: PatternMatch, canReplace: boolean): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    const insertedBlock = await BlockManager.paste(match.tool, match.event, canReplace);

    Caret.setToBlock(insertedBlock, Caret.positions.END);
  }
}
