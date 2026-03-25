// src/tools/callout/callout-keyboard.ts

import type { API } from '../../../types';
import type { CalloutData } from './types';

interface CalloutEnterContext {
  api: API;
  blockId: string;
  data: CalloutData;
  textElement: HTMLElement;
}

interface CalloutBackspaceContext {
  api: API;
  blockId: string;
  data: CalloutData;
  textElement: HTMLElement;
  event: KeyboardEvent;
}

interface FirstChildBackspaceContext {
  api: API;
  calloutBlockId: string | undefined;
  firstChildBlockId: string;
  event: KeyboardEvent;
}

/**
 * Handle Enter key inside a callout's own text element.
 * Inserts a new child block and moves caret to it.
 */
export async function handleCalloutEnter(ctx: CalloutEnterContext): Promise<void> {
  const blockIndex = ctx.api.blocks.getBlockIndex(ctx.blockId);
  const insertIndex = blockIndex !== undefined ? blockIndex + 1 : 0;
  const newBlock = await ctx.api.blocks.insertInsideParent(ctx.blockId, insertIndex);

  ctx.api.caret.setToBlock(newBlock.id, 'start');
}

/**
 * Handle Backspace on the callout's own text element.
 * Converts to paragraph when the text is empty and caret is at the start.
 */
export async function handleCalloutBackspace(ctx: CalloutBackspaceContext): Promise<void> {
  const isEmpty = ctx.textElement.textContent === '';

  if (!isEmpty) {
    return;
  }

  const selection = window.getSelection();
  const isAtStart = selection !== null &&
    selection.rangeCount > 0 &&
    selection.getRangeAt(0).startOffset === 0 &&
    selection.getRangeAt(0).collapsed;

  if (!isAtStart) {
    return;
  }

  ctx.event.preventDefault();
  await ctx.api.blocks.convert(ctx.blockId, 'paragraph');
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
