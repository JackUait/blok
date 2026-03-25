// src/tools/callout/callout-keyboard.ts

import type { API } from '../../../types';

interface FirstChildBackspaceContext {
  api: API;
  calloutBlockId: string | undefined;
  firstChildBlockId: string;
  event: KeyboardEvent;
}

/**
 * Handle Backspace on an empty first child block inside a callout.
 *
 * - If the callout has only this one child: convert the callout to a paragraph (removes callout).
 * - If the callout has other children: delete the empty first child and move caret before the callout.
 */
export async function handleCalloutFirstChildBackspace(ctx: FirstChildBackspaceContext): Promise<void> {
  if (ctx.calloutBlockId === undefined) {
    return;
  }

  const children = ctx.api.blocks.getChildren(ctx.calloutBlockId);

  ctx.event.preventDefault();

  if (children.length <= 1) {
    // Only child — remove the entire callout by converting to paragraph
    await ctx.api.blocks.convert(ctx.calloutBlockId, 'paragraph');
    return;
  }

  // Multiple children — delete the empty first child and move caret before callout
  const firstChildIndex = ctx.api.blocks.getBlockIndex(ctx.firstChildBlockId);

  if (firstChildIndex !== undefined) {
    await ctx.api.blocks.delete(firstChildIndex);
  }

  const calloutIndex = ctx.api.blocks.getBlockIndex(ctx.calloutBlockId);

  if (calloutIndex !== undefined && calloutIndex > 0) {
    ctx.api.caret.setToBlock(calloutIndex - 1, 'end');
  }
}
