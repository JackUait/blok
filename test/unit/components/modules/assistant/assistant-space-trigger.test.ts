import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../../types';
import type { AgentModel } from '../../../../../types/api';

const AI_PLACEHOLDER = 'Press ‘space’ for AI or ‘/’ for commands';
const PLAIN_PLACEHOLDER = 'Write something or press / to select a tool';

const editors: Blok[] = [];

const model: AgentModel = async () => {
  throw new Error('unscripted model call');
};

const createEditor = async (withAssistant: boolean, extra: Partial<BlokConfig> = {}): Promise<Blok> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks: [
        { id: 'empty', type: 'paragraph', data: { text: '' } },
        { id: 'full', type: 'paragraph', data: { text: 'Hello' } },
      ],
    },
    ...(withAssistant ? { agent: { assistant: { model } } } : {}),
    ...extra,
  });

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const input = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-tool="paragraph"]`);

  if (element === null) {
    throw new Error(`no paragraph ${id}`);
  }

  return element;
};

const pressSpace = (target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

const barOpen = (): boolean => screen.queryByRole('dialog', { name: 'Ask AI' }) !== null;

describe('assistant: space in an empty paragraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the AI placeholder when an assistant is configured', async () => {
    await createEditor(true);

    expect(input('empty')).toHaveAttribute('data-blok-placeholder-active', AI_PLACEHOLDER);
  });

  it('keeps the plain placeholder without an assistant', async () => {
    await createEditor(false);

    expect(input('empty')).toHaveAttribute('data-blok-placeholder-active', PLAIN_PLACEHOLDER);
  });

  it('keeps a placeholder the host set', async () => {
    await createEditor(true, { placeholder: 'Start here' });

    expect(input('empty')).toHaveAttribute('data-blok-placeholder-active', 'Start here');
  });

  it('opens Ask AI and types no space', async () => {
    await createEditor(true);
    input('empty').focus();

    const event = pressSpace(input('empty'));

    expect(barOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('types a space in a paragraph with text', async () => {
    await createEditor(true);
    input('full').focus();

    const event = pressSpace(input('full'));

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('types a space with a modifier held', async () => {
    await createEditor(true);
    input('empty').focus();

    const event = pressSpace(input('empty'), { shiftKey: true });

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves space alone in read-only mode', async () => {
    await createEditor(true, { readOnly: true });

    const event = pressSpace(input('empty'));

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('types a space without an assistant', async () => {
    await createEditor(false);
    input('empty').focus();

    const event = pressSpace(input('empty'));

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
