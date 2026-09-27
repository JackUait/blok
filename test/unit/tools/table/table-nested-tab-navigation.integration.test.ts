import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData } from '../../../../types';

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: ['right'] }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', 'right', 'bottom-left', 'bottom-right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['i00'] }, { blocks: ['i01'] }],
        [{ blocks: ['i10'] }, { blocks: ['i11'] }],
      ],
    },
    content: ['i00', 'i01', 'i10', 'i11'],
  },
  ...['i00', 'i01', 'i10', 'i11'].map(id => ({
    id,
    type: 'paragraph',
    parent: 'inner',
    data: { text: id },
  })),
  { id: 'right', type: 'paragraph', parent: 'outer', data: { text: 'Right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'Bottom left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'Bottom right' } },
  { id: 'after', type: 'paragraph', data: { text: 'After' } },
];

describe('Tab navigation in a table with a nested table', () => {
  let holder: HTMLDivElement;
  let editor: Blok;

  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({ holder, tools: { table: Table, paragraph: Paragraph }, data: { blocks } });
    await editor.isReady;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    // jsdom does not reflect the contentEditable property as an attribute.
    holder.querySelectorAll<HTMLElement>('[data-blok-tool="paragraph"]').forEach(input => {
      if (input.contentEditable === 'true') {
        input.setAttribute('contenteditable', 'true');
      }
    });
  });

  afterEach(() => {
    editor.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('moves from the outer top-right cell to the outer bottom-left cell', () => {
    const rightInput = holder.querySelector<HTMLElement>('[data-blok-id="right"] [contenteditable="true"]');

    if (rightInput === null) {
      throw new Error('outer top-right input is missing');
    }
    rightInput.focus();
    rightInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('bottom-left');
  });

  it('leaves the outer table on Tab from its last cell', () => {
    const lastInput = holder.querySelector<HTMLElement>('[data-blok-id="bottom-right"] [contenteditable="true"]');

    if (lastInput === null) {
      throw new Error('outer bottom-right input is missing');
    }
    lastInput.focus();
    lastInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('after');
  });
});
