import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onPropertyHover } from '../../../../src/tools/database/property-hint';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

describe('onPropertyHover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroyTooltip();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mountTrigger = (): HTMLElement => {
    const trigger = document.createElement('div');

    document.body.appendChild(trigger);
    onPropertyHover(trigger, 'Notes', 'About it');

    return trigger;
  };

  it('shows the hint on the left in left-to-right text', () => {
    hover(mountTrigger());
    vi.advanceTimersByTime(HINT_DELAY);

    expect(shownHint()).toEqual({ text: 'NotesAbout it', placement: 'left' });
  });

  // Like the peek handle hint: the inline-start side, which is the right in RTL.
  it('shows the hint on the right in right-to-left text, read when the pointer enters', () => {
    const trigger = mountTrigger();

    trigger.style.direction = 'rtl';
    hover(trigger);
    vi.advanceTimersByTime(HINT_DELAY);

    expect(shownHint()).toEqual({ text: 'NotesAbout it', placement: 'right' });
  });
});
