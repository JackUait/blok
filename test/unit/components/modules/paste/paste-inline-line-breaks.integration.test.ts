/**
 * An inline paste (html with no block tags) into a text field must keep
 * its line breaks. The field's own rules decide what survives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { Quote } from '../../../../../src/tools/quote';
import { ListItem } from '../../../../../src/tools/list';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { BoldInlineTool } from '../../../../../src/components/inline-tools/inline-tool-bold';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, quote: Quote, list: ListItem, toggle: ToggleItem, bold: BoldInlineTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const pasteInto = async (instance: TestEditor, id: string, data: Record<string, string>): Promise<void> => {
  const target = Array.from(holder?.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`) ?? [])
    .find(element => element.contentEditable === 'true');

  if (target === null || target === undefined) {
    throw new Error('no paste target');
  }

  // jsdom does not reflect the property to the attribute; a browser does.
  target.setAttribute('contenteditable', 'true');
  target.focus();
  instance.caret.setToBlock(id, 'end');
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
  await settle();
  await settle();
};

const savedText = async (instance: TestEditor, id: string): Promise<unknown> =>
  (await instance.save()).blocks.find(block => block.id === id)?.data.text;

const HTML = 'Line one<br>Line <strong>bold</strong> two';
const PLAIN = 'Line one\nLine bold two';

describe('inline html paste keeps <br>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it.each([
    ['paragraph', {}],
    ['header', { level: 2 }],
    ['quote', {}],
    ['list', { style: 'unordered' }],
    ['toggle', {}],
  ])('keeps the line break when pasted into a %s', async (type, extra) => {
    const instance = await boot([{ id: 't', type, data: { text: 'X', ...extra } }]);

    await pasteInto(instance, 't', { 'text/html': HTML, 'text/plain': PLAIN });

    expect(await savedText(instance, 't')).toBe(`X${HTML}`);
  });

  it('keeps a Google Docs line break', async () => {
    const instance = await boot([{ id: 't', type: 'paragraph', data: { text: 'X' } }]);
    const html = '<b style="font-weight:normal" id="docs-internal-guid-x"><span style="font-weight:700">bold</span><br><span>next</span></b>';

    await pasteInto(instance, 't', { 'text/html': html, 'text/plain': 'bold\nnext' });

    expect(await savedText(instance, 't')).toBe('X<strong>bold</strong><br>next');
  });
});
