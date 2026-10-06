/**
 * RTL tables pasted from other apps through a real Blok. Placement left/right
 * mean the grid's start/end, so a right-aligned cell of an RTL grid is the
 * grid start (no placement saved).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { isCellWithBlocks } from '../../../../../src/tools/table/types';
import type { TableData } from '../../../../../src/tools/table/types';
import type { OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let holder: HTMLDivElement;
let blok: TestEditor | null = null;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const boot = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: '' } }] },
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const pasteHtml = async (html: string, plain: string): Promise<void> => {
  const target = holder.querySelector<HTMLElement>('[data-blok-id="p"] [data-blok-element-content] > *');

  if (target === null) {
    throw new Error('no paragraph to paste into');
  }
  const data: Record<string, string> = { 'text/html': html, 'text/plain': plain };
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  });
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
  await settle();
  await settle();
  await settle(20);
};

const placements = (saved: OutputData): Array<string | undefined> => {
  const table = saved.blocks.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error(`no table saved: ${JSON.stringify(saved.blocks.map(b => b.type))}`);
  }

  return (table.data as TableData).content[0].map(cell => (isCellWithBlocks(cell) ? cell.placement : 'string-cell'));
};

const pastedPlacements = async (html: string): Promise<Array<string | undefined>> => {
  const editor = await boot();

  await pasteHtml(html, 'A\tB');

  return placements(await editor.save());
};

const ROW = '<tr><td style="text-align: right">A</td><td style="text-align: left">B</td></tr>';

describe('RTL table paste keeps cell placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('control: dir="rtl" on the table reads right as the grid start', async () => {
    expect(await pastedPlacements(`<table dir="rtl">${ROW}</table>`)).toEqual([undefined, 'top-right']);
  });

  it('dir="rtl" on a wrapper around the table', async () => {
    expect(await pastedPlacements(`<div dir="rtl"><table>${ROW}</table></div>`)).toEqual([undefined, 'top-right']);
  });

  it('dir="rtl" on the clipboard document body (Word-style)', async () => {
    expect(await pastedPlacements(`<html><body dir="rtl"><table>${ROW}</table></body></html>`)).toEqual([undefined, 'top-right']);
  });

  it('direction: rtl as an inline style on the table', async () => {
    expect(await pastedPlacements(`<table style="direction: rtl">${ROW}</table>`)).toEqual([undefined, 'top-right']);
  });

  it('text-align: end in an LTR table is the grid end', async () => {
    expect(await pastedPlacements('<table><tr><td style="text-align: end">A</td><td>B</td></tr></table>')).toEqual(['top-right', undefined]);
  });

  it('text-align: start in an RTL table is the grid start', async () => {
    expect(await pastedPlacements('<table dir="rtl"><tr><td style="text-align: start">A</td><td style="text-align: end">B</td></tr></table>')).toEqual([undefined, 'top-right']);
  });
});
