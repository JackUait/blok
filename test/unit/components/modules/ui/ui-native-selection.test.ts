/**
 * Opt-out for Blok's forced native-selection repaint.
 *
 * Blok recolors ::selection in two places: a preflight.css rule scoped to
 * [data-blok-interface] and a Tailwind arbitrary variant stamped on the
 * editor wrapper in UI.make(). A token override can recolor the highlight
 * but can never express "use the UA default" (CSS-wide keywords are invalid
 * through var()), which forced hosts into `background-color: revert
 * !important` specificity wars. `config.style.nativeSelection: true` is the
 * first-class opt-out: it stamps `data-blok-native-selection` on the wrapper
 * (gating the preflight rule) and omits the selection utility class.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UI } from '../../../../../src/components/modules/ui';
import type { BlokConfig } from '../../../../../types';

const NATIVE_SELECTION_ATTR = 'data-blok-native-selection';
const SELECTION_UTILITY_CLASS = '[&_::selection]:bg-selection-inline';

const makeWrapper = (configOverrides: Partial<BlokConfig> = {}): HTMLElement => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const ui = new UI({
    config: {
      holder,
      minHeight: 50,
      ...configOverrides,
    } as BlokConfig,
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as UI['eventsDispatcher'],
  });

  (ui as unknown as { make: () => void }).make();

  const wrapper = (ui as { nodes: UI['nodes'] }).nodes.wrapper;

  if (!(wrapper instanceof HTMLElement)) {
    throw new Error('UI.make() did not create a wrapper element');
  }

  return wrapper;
};

describe('UI native selection opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('by default repaints selection: utility class present, opt-out attribute absent', () => {
    const wrapper = makeWrapper();

    expect(wrapper.className).toContain(SELECTION_UTILITY_CLASS);
    expect(wrapper.hasAttribute(NATIVE_SELECTION_ATTR)).toBe(false);
  });

  it('with style.nativeSelection: true stamps the opt-out attribute and omits the selection utility class', () => {
    const wrapper = makeWrapper({ style: { nativeSelection: true } });

    expect(wrapper.hasAttribute(NATIVE_SELECTION_ATTR)).toBe(true);
    expect(wrapper.className).not.toContain(SELECTION_UTILITY_CLASS);
  });
});
