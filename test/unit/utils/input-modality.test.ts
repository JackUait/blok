import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as InputModality from '../../../src/components/utils/input-modality';

/**
 * `input-modality` is a module-level singleton with document listeners
 * installed at import. Three of its properties are load-bearing far away from
 * this file, and each one fails SILENTLY if a refactor drops it:
 *
 * 1. It stamps `data-blok-modality` on the document element. `preflight.css`
 *    keys the whole pointer-gesture outline suppression off that attribute, so
 *    dropping the stamp brings every mouse-driven focus ring back with no test
 *    failing anywhere near the change.
 * 2. The listeners are CAPTURE phase. Blok's own handlers call
 *    `stopPropagation` freely; a bubble-phase tracker would simply stop seeing
 *    gestures inside popovers, which is exactly where the rings appear.
 * 3. The default is `keyboard`. A surface opened before any gesture — a
 *    programmatic `open()`, a unit test — must still expose its focus cursor.
 *    Flipping the default to `pointer` would hide the cursor from keyboard
 *    users until they happened to press a key.
 *
 * The module is re-imported per test with `resetModules` so the install-time
 * behaviour is observable rather than shared across cases.
 */

const MODALITY_ATTRIBUTE = 'data-blok-modality';

/**
 * Imports a fresh copy of the tracker, running its install side effects again.
 * @returns the module's public surface
 */
const loadTracker = async (): Promise<typeof InputModality> => {
  vi.resetModules();

  return import('../../../src/components/utils/input-modality');
};

describe('input-modality', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(MODALITY_ATTRIBUTE);
  });

  afterEach(() => {
    document.documentElement.removeAttribute(MODALITY_ATTRIBUTE);
  });

  it('starts in keyboard modality so a surface opened before any gesture keeps its cursor', async () => {
    const { isKeyboardModality } = await loadTracker();

    expect(isKeyboardModality()).toBe(true);
  });

  it('stamps the modality on the document element at import — preflight.css reads it', async () => {
    await loadTracker();

    expect(document.documentElement.getAttribute(MODALITY_ATTRIBUTE)).toBe('keyboard');
  });

  it('records a pointer gesture and publishes it to the document element', async () => {
    const { isKeyboardModality } = await loadTracker();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(isKeyboardModality()).toBe(false);
    expect(document.documentElement.getAttribute(MODALITY_ATTRIBUTE)).toBe('pointer');
  });

  it('returns to keyboard modality on the next keystroke', async () => {
    const { isKeyboardModality } = await loadTracker();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Tab',
    }));

    expect(isKeyboardModality()).toBe(true);
    expect(document.documentElement.getAttribute(MODALITY_ATTRIBUTE)).toBe('keyboard');
  });

  it('sees a gesture whose handler stops propagation, because it listens in the capture phase', async () => {
    const { isKeyboardModality } = await loadTracker();

    const swallow = (event: Event): void => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.body.addEventListener('pointerdown', swallow, true);

    try {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(isKeyboardModality(), 'a bubble-phase tracker would have missed this gesture').toBe(false);
    } finally {
      document.body.removeEventListener('pointerdown', swallow, true);
    }
  });

  it('sees a swallowed keystroke too', async () => {
    const { isKeyboardModality } = await loadTracker();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    const swallow = (event: Event): void => {
      event.stopImmediatePropagation();
    };

    document.body.addEventListener('keydown', swallow, true);

    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'a',
      }));

      expect(isKeyboardModality()).toBe(true);
    } finally {
      document.body.removeEventListener('keydown', swallow, true);
    }
  });

  /**
   * `Flipper.activate()` registers its keydown handler on `document` AND
   * `window`, both capture (`src/components/flipper.ts:198-199`), and calls
   * `stopImmediatePropagation()` for every key it owns (`:421-422`). Capture
   * runs window before document, so a tracker listening only on `document`
   * goes blind to arrows and Enter for as long as any popover is open.
   *
   * That is not cosmetic. The colour picker only focuses its tab when
   * `isKeyboardModality()` is true, so a blind tracker leaves the picker
   * unreachable by keyboard whenever the parent menu was opened with a mouse.
   * The tracker therefore has to be on `window` too, and because it installs at
   * import it wins the capture order against every later `activate()`.
   */
  it('still sees a key that an active Flipper swallows on window capture', async () => {
    const { isKeyboardModality } = await loadTracker();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isKeyboardModality()).toBe(false);

    // Registered after the tracker, exactly as Flipper.activate() would be.
    const flipperLike = (event: Event): void => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener('keydown', flipperLike, true);

    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowDown',
      }));

      expect(
        isKeyboardModality(),
        'an arrow key inside an open popover must still count as a keyboard gesture'
      ).toBe(true);
    } finally {
      window.removeEventListener('keydown', flipperLike, true);
    }
  });
});
