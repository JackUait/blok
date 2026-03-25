// src/tools/callout/callout-keyboard.ts

import type { API } from '../../../types';
import type { CalloutData } from './types';

interface KeyboardContext {
  api: API;
  blockId: string | undefined;
  data: CalloutData;
  textElement: HTMLElement;
}

interface BackspaceContext extends KeyboardContext {
  event: KeyboardEvent;
}

export async function handleCalloutEnter(ctx: KeyboardContext): Promise<void> {
  if (ctx.blockId === undefined) {
    return;
  }

  const blockIndex = ctx.api.blocks.getBlockIndex(ctx.blockId);

  if (blockIndex === undefined) {
    return;
  }

  const newBlock = ctx.api.blocks.insertInsideParent(ctx.blockId, blockIndex + 1);
  ctx.api.caret.setToBlock(newBlock.id, 'start');
}

export async function handleCalloutBackspace(ctx: BackspaceContext): Promise<void> {
  if (ctx.blockId === undefined) {
    return;
  }

  const isEmpty = ctx.textElement.innerHTML === '' || ctx.textElement.textContent === '';
  const selection = window.getSelection();
  const isAtStart = selection !== null &&
    selection.rangeCount > 0 &&
    selection.getRangeAt(0).startOffset === 0 &&
    selection.getRangeAt(0).collapsed;

  if (isEmpty && isAtStart) {
    ctx.event.preventDefault();
    await ctx.api.blocks.convert(ctx.blockId, 'paragraph');
  }
}
