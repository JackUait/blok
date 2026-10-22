import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { AgentModel } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: { openAssistant(): void };
}

/** The registry key the ::highlight() rule in main.css targets. */
const TINT = 'blok-assistant-selection';

const editors: TestEditor[] = [];
const registry = new Map<string, { ranges: Range[] }>();
const originals = new Map<string, PropertyDescriptor | undefined>();

/** jsdom has no Custom Highlight API; record what the editor registers. */
const installHighlights = (): void => {
  for (const name of ['CSS', 'Highlight']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, 'CSS', { value: { highlights: registry }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'Highlight', {
    value: function Highlight(this: { ranges: Range[] }, ...ranges: Range[]) {
      this.ranges = ranges;
    },
    configurable: true,
    writable: true,
  });
};

const restoreHighlights = (): void => {
  for (const [name, descriptor] of originals) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
  originals.clear();
};

const model: AgentModel = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });

const createEditor = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Hello world' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second line' } },
      ],
    },
    agent: { assistant: { model } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  // jsdom does not reflect `contentEditable = 'true'` to the attribute a browser shows.
  document.querySelectorAll('[data-blok-tool="paragraph"]').forEach((input) => input.setAttribute('contenteditable', 'true'));

  return editor;
};

const inputOf = (id: string): HTMLElement => {
  const input = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-tool="paragraph"]`);

  if (input === null) {
    throw new Error(`no input in ${id}`);
  }

  return input;
};

const select = (startId: string, startOffset: number, endId: string, endOffset: number): void => {
  const start = inputOf(startId);
  const end = inputOf(endId);
  const range = document.createRange();

  start.focus();
  range.setStart(start.firstChild ?? start, startOffset);
  range.setEnd(end.firstChild ?? end, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const tintedTexts = (): string[] => registry.get(TINT)?.ranges.map((range) => range.toString()) ?? [];

describe('Ask AI keeps the selection visible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.clear();
    installHighlights();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    restoreHighlights();
    vi.restoreAllMocks();
  });

  it('tints the selected text while the bar is open', async () => {
    const editor = await createEditor();

    select('p1', 0, 'p1', 5);
    editor.agent.openAssistant();

    expect(tintedTexts()).toEqual(['Hello']);
  });

  it('tints a selection across blocks one field at a time', async () => {
    const editor = await createEditor();

    select('p1', 6, 'p2', 6);
    editor.agent.openAssistant();

    expect(tintedTexts()).toEqual(['world', 'Second']);
  });

  it('paints nothing when opened at a caret', async () => {
    const editor = await createEditor();

    select('p1', 2, 'p1', 2);
    editor.agent.openAssistant();

    expect(registry.has(TINT)).toBe(false);
  });

  it('removes the tint when the bar closes', async () => {
    const editor = await createEditor();

    select('p1', 0, 'p1', 5);
    editor.agent.openAssistant();
    const field = within(screen.getByRole('dialog', { name: 'Ask AI' })).getByRole('textbox');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(registry.has(TINT)).toBe(false);
  });
});
