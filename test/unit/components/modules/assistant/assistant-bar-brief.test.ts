import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

import { AssistantBar } from '../../../../../src/components/modules/assistant/assistant-bar';

const callbacks = {
  onSubmit: vi.fn(),
  onStop: vi.fn(),
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  onContinue: vi.fn(),
  onEscape: vi.fn(),
  onThinking: vi.fn(),
};

const summaryOf = (bar: AssistantBar): string => bar.element.querySelector('[data-blok-assistant-summary]')?.textContent ?? '';

describe('assistant bar: the note after an edit', () => {
  let bar: AssistantBar;

  beforeEach(() => {
    vi.clearAllMocks();
    bar = new AssistantBar((key) => key, callbacks);
    document.body.append(bar.element);
  });

  afterEach(() => {
    bar.element.remove();
    vi.restoreAllMocks();
  });

  it('shows a long note whole: the model keeps it short, the bar never cuts it', async () => {
    const reply = 'Готово: сразу под вашим курсором появился короткий абзац о том, что водный дефицит в Европе чаще сезонный.';

    bar.render({ kind: 'answered', reply, changed: true, edited: true });

    await waitFor(() => expect(summaryOf(bar)).toBe(reply));
  });

  it('shows a short note as written', async () => {
    bar.render({ kind: 'answered', reply: 'Added a paragraph and a callout about saving water.', changed: true, edited: true });

    await waitFor(() => expect(summaryOf(bar)).toBe('Added a paragraph and a callout about saving water.'));
  });

  it('never cuts the answer to a question', async () => {
    const reply = 'The page talks about water shortages in southern Europe and how saving water is the cheapest source.';

    bar.render({ kind: 'answered', reply, changed: false, edited: false });

    await waitFor(() => expect(summaryOf(bar)).toBe(reply));
  });
});
