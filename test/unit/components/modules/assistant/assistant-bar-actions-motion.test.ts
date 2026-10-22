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

/** The chips' row at full height, in px. */
const FULL = 38;

interface Motion {
  target: Element;
  keyframes: Keyframe[];
  onfinish: ((event: AnimationPlaybackEvent) => void) | null;
  cancel: () => void;
  cancelled: boolean;
}

const finish = (motion: Motion): void => {
  motion.onfinish?.(new Event('finish') as AnimationPlaybackEvent);
};

describe('assistant bar: the actions row unfolds and folds', () => {
  let bar: AssistantBar;
  let anchor: HTMLElement;
  let motions: Motion[];

  // By attribute: testing-library names no inert or hidden element, and these tests check both.
  const group = (): HTMLElement => bar.element.querySelector<HTMLElement>('[role="group"][aria-label="assistant.actions"]') ?? fail('no actions group');
  const field = (): HTMLTextAreaElement => {
    const found = within(bar.element).getByRole('textbox');

    return found instanceof HTMLTextAreaElement ? found : fail('the field is not a textarea');
  };
  const type = (text: string): void => {
    field().value = text;
    fireEvent.input(field());
  };
  const groupMotions = (): Motion[] => motions.filter((motion) => motion.target === group());
  const last = (): Motion => groupMotions().at(-1) ?? fail('the row did not move');
  const height = (keyframe: Keyframe | undefined): unknown => keyframe?.height;

  beforeEach(() => {
    vi.clearAllMocks();
    motions = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value(this: Element, keyframes: Keyframe[]): Animation {
        const motion: Motion = {
          target: this,
          keyframes,
          onfinish: null,
          cancelled: false,
          cancel() {
            motion.cancelled = true;
          },
        };

        motions.push(motion);

        return motion as unknown as Animation;
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, 600, this.matches('[data-blok-assistant-actions]') ? FULL : 0);
    });

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
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unfolds the row from nothing when the bar opens, so the page below glides down', () => {
    const motion = last();

    expect(height(motion.keyframes[0])).toBe('0px');
    expect(height(motion.keyframes.at(-1))).toBe(`${FULL}px`);
    expect(group().hidden).toBe(false);
  });

  it('folds the row away on the first keystroke, and hides it only once the fold ends', () => {
    finish(last());
    type('W');

    const fold = last();

    expect(height(fold.keyframes.at(-1))).toBe('0px');
    expect(group().hidden).toBe(false);
    expect(group().inert).toBe(true);

    finish(fold);

    expect(group().hidden).toBe(true);
    expect(group().inert).toBe(false);
  });

  it('keeps one fold going while the user types on', () => {
    finish(last());
    type('W');
    const count = groupMotions().length;

    type('Wr');
    type('Wri');

    expect(groupMotions()).toHaveLength(count);
  });

  it('unfolds again from where the fold got to when the field is cleared', () => {
    finish(last());
    type('W');
    const fold = last();

    type('');

    expect(fold.cancelled).toBe(true);
    expect(height(last().keyframes.at(-1))).toBe(`${FULL}px`);
    expect(group().inert).toBe(false);

    finish(fold);
    expect(group().hidden).toBe(false);
  });

  it('jumps straight to the end with reduced motion', () => {
    bar.close();
    motions = [];
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));

    bar.open(anchor, { left: 0, width: 600 });
    type('W');

    expect(groupMotions()).toHaveLength(0);
    expect(group().hidden).toBe(true);
  });
});
