import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

const sheets = vi.hoisted(() => ({
  load: vi.fn((): Promise<void> => Promise.resolve()),
}));

vi.mock('../../../../../src/components/utils/lazy-styles', () => ({
  loadSheet: sheets.load,
}));

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

const REPLY = 'The page is about water.\n\n> [!TIP]\n> Drink more.';

describe('assistant bar: a reply\'s Markdown styles', () => {
  let bar: AssistantBar;

  const alertIn = (): Element | null => bar.element.querySelector('[data-blok-assistant-reply] .blok-md-alert');

  beforeEach(() => {
    vi.clearAllMocks();
    bar = new AssistantBar((key) => key, callbacks);
    document.body.append(bar.element);
  });

  afterEach(() => {
    bar.element.remove();
    sheets.load.mockImplementation(() => Promise.resolve());
    vi.restoreAllMocks();
  });

  it('renders a reply\'s alerts only once the media sheet that styles them is in', async () => {
    const gate: { open?: () => void } = {};

    sheets.load.mockImplementation(() => new Promise<void>((resolve) => {
      gate.open = resolve;
    }));

    bar.render({ kind: 'answered', reply: REPLY, changed: false, edited: false });

    expect(sheets.load).toHaveBeenCalledWith('media');
    // Long enough for the Markdown chunk to load on its own.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alertIn()).toBeNull();

    gate.open?.();

    await waitFor(() => expect(alertIn()).not.toBeNull());
  });
});
