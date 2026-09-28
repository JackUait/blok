import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountToolbarGhost, TOOLBAR_GHOST_ATTR } from '../../../../../../src/components/modules/toolbar/inline/toolbar-ghost';

describe('mountToolbarGhost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('strips the direct-menu marker so a fading menu never replays its entrance', () => {
    const parent = document.createElement('div');
    const wrapper = document.createElement('div');
    const root = document.createElement('div');

    root.setAttribute('data-blok-inline-direct-menu', 'toolbar');
    root.setAttribute('data-blok-popover-inline', '');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 192, 120));
    parent.append(wrapper, root);
    document.body.append(parent);

    mountToolbarGhost(root, wrapper, null);

    const ghost = parent.querySelector(`[${TOOLBAR_GHOST_ATTR}]`);

    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector('[data-blok-inline-direct-menu]')).toBeNull();
    expect(ghost?.querySelector('[data-blok-popover-inline]')).not.toBeNull();
  });
});
