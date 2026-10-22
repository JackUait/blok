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

  it('lays one light over each rose, on the same line, coloured by its own gradient', () => {
    const other = new AssistantBar((key) => key, callbacks);
    const marks = [...bar.element.querySelectorAll('[data-blok-assistant-icon]'), ...other.element.querySelectorAll('[data-blok-assistant-icon]')];
    const rose = new DOMParser().parseFromString(IconRose, 'image/svg+xml').querySelector('path')?.getAttribute('d');
    const ids = marks.map((mark) => {
      const lights = mark.querySelectorAll('[data-blok-assistant-light]');
      const light = lights[0];
      const id = light?.getAttribute('stroke')?.match(/^url\(#(.+)\)$/)?.[1] ?? '';

      // One path only: no blurred copy under it.
      expect(lights).toHaveLength(1);
      expect(mark.querySelectorAll('path')).toHaveLength(2);
      expect(light?.getAttribute('d')).toBe(rose);
      expect(light?.getAttribute('pathLength')).toBe('100');
      expect(mark.querySelector(`linearGradient[id="${id}"]`)?.querySelectorAll('stop')).toHaveLength(3);

      return id;
    });

    expect(new Set(ids).size).toBe(4);
  });
});
