import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';

import { AssistantBar } from '../../../../../src/components/modules/assistant/assistant-bar';

const callbacks = {
  onSubmit: vi.fn(),
  onStop: vi.fn(),
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  onContinue: vi.fn(),
  onInsert: vi.fn(),
  onEscape: vi.fn(),
  onThinking: vi.fn(),
};

const fail = (message: string): never => {
  throw new Error(message);
};

const ACTIONS = [
  { label: 'Summarize', prompt: 'Summarize the document.' },
  { label: 'Fix spelling and grammar', prompt: 'Fix the spelling.' },
];

describe('assistant bar: action buttons and Insert', () => {
  let bar: AssistantBar;
  let anchor: HTMLElement;

  // By attribute: testing-library names no hidden element, and these tests check hiding.
  const group = (): HTMLElement => bar.element.querySelector<HTMLElement>('[role="group"][aria-label="assistant.actions"]') ?? fail('no actions group');
  const field = (): HTMLTextAreaElement => {
    const found = within(bar.element).getByRole('textbox');

    return found instanceof HTMLTextAreaElement ? found : fail('the field is not a textarea');
  };
  const type = (text: string): void => {
    field().value = text;
    fireEvent.input(field());
  };
  const insert = (): HTMLElement => [...bar.element.querySelectorAll<HTMLElement>('button')]
    .find((button) => button.textContent === 'assistant.insert') ?? fail('no Insert button');

  beforeEach(() => {
    vi.clearAllMocks();
    bar = new AssistantBar((key) => key, callbacks);
    anchor = document.createElement('div');
    document.body.append(anchor);
    bar.setActions(ACTIONS);
    bar.open(anchor, { left: 0, width: 600 });
  });

  afterEach(() => {
    bar.close();
    bar.element.remove();
    anchor.remove();
    vi.restoreAllMocks();
  });

  it('sends an action\'s prompt when its button is pressed', () => {
    fireEvent.click(within(group()).getByRole('button', { name: 'Summarize' }));

    expect(callbacks.onSubmit).toHaveBeenCalledWith('Summarize the document.');
  });

  it('draws an action\'s icon before its label, hidden from screen readers', () => {
    bar.setActions([{ label: 'Summarize', prompt: 'Summarize.', icon: '<svg data-testid="summary-icon"></svg>' }, { label: 'Plain', prompt: 'Plain.' }]);

    const [withIcon, plain] = within(group()).getAllByRole('button');

    expect(withIcon).toHaveAccessibleName('Summarize');
    expect(withIcon.querySelector('[aria-hidden="true"] svg[data-testid="summary-icon"]')).not.toBeNull();
    expect(plain).toHaveAccessibleName('Plain');
    expect(plain.querySelector('svg')).toBeNull();
  });

  it('staggers the actions: each one knows its place for the rise-in', () => {
    const buttons = within(group()).getAllByRole('button');

    expect(buttons.map((button) => button.style.getPropertyValue('--blok-assistant-action-index'))).toEqual(['0', '1']);
  });

  it('shows Stop as a round stop key named Stop, with no visible text', () => {
    bar.render({ kind: 'working', status: 'Thinking…' });

    const stop = within(bar.element).getByRole('button', { name: 'assistant.stop' });

    expect(stop.hasAttribute('data-blok-assistant-stop')).toBe(true);
    expect(stop.textContent).toBe('');
  });

  it('puts the actions under the field, so the field never moves when they hide', () => {
    const row = field().closest('[data-blok-assistant-row]');

    expect(row?.compareDocumentPosition(group()) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('hides the actions once the user types, and shows them again for an empty field', () => {
    type('Write a poem');
    expect(group().hidden).toBe(true);

    type('');
    expect(group().hidden).toBe(false);
  });

  it('hides the actions while the model works and after it answers', () => {
    bar.render({ kind: 'working', status: 'Thinking…' });
    expect(group().hidden).toBe(true);

    bar.render({ kind: 'answered', reply: 'Done.', changed: true, edited: true });
    expect(group().hidden).toBe(true);
  });

  it('shows no group when there are no actions', () => {
    bar.setActions([]);

    expect(group().hidden).toBe(true);
  });

  it('covers an empty block with its field row, and grows the actions down, not over the block above', () => {
    const ROW = 44;
    const ACTIONS_HEIGHT = 38;
    const rect = (top: number, height: number): DOMRect => new DOMRect(0, top, 600, height);

    bar.close();
    bar.setActions(ACTIONS);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 24));
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue(rect(0, ROW + ACTIONS_HEIGHT));
    vi.spyOn(group(), 'getBoundingClientRect').mockReturnValue(rect(0, ACTIONS_HEIGHT));

    bar.open(anchor, { left: 0, width: 600 }, true);

    // The field row is centred on the 24px block: 100 + (24 - 44) / 2.
    expect(bar.element.style.top).toBe('90px');
  });

  it('offers Insert for an answer that did not edit the page', () => {
    bar.render({ kind: 'answered', reply: 'The page is about water.', changed: false, edited: false });

    expect(insert().hidden).toBe(false);
    fireEvent.click(insert());
    expect(callbacks.onInsert).toHaveBeenCalledTimes(1);
  });

  it('offers no Insert after an edit: the page already shows the work', () => {
    bar.render({ kind: 'answered', reply: 'Shortened the text.', changed: true, edited: true });

    expect(insert().hidden).toBe(true);
  });

  it('offers no Insert for an empty answer, an error or while working', () => {
    bar.render({ kind: 'answered', reply: '  ', changed: false, edited: false });
    expect(insert().hidden).toBe(true);

    bar.render({ kind: 'error', message: 'Failed', changed: false });
    expect(insert().hidden).toBe(true);

    bar.render({ kind: 'working', status: 'Thinking…' });
    expect(insert().hidden).toBe(true);
  });
});
