import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconRose } from '../../../../../src/components/icons';
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

describe('assistant bar: its mark', () => {
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

  it('draws the rose next to the field and next to the answer', () => {
    const marks = [...bar.element.querySelectorAll('[data-blok-assistant-icon]')];
    const rose = new DOMParser().parseFromString(IconRose, 'image/svg+xml').querySelector('path')?.getAttribute('d');

    expect(marks).toHaveLength(2);
    marks.forEach((mark) => expect(mark.querySelector('path')?.getAttribute('d')).toBe(rose));
  });
});
