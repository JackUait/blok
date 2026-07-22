/**
 * The `data-blok-controls-hidden` wrapper attribute — the CSS hook that
 * collapses the editor gutter ONLY when the editor chrome is genuinely gone
 * (readOnly with hideControls). Plain read-only must NOT carry it: the
 * copy-link block-hover control still lives in the gutter, and in-place
 * `readOnly.set()` mode flips must not shift the document sideways.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../src/tools/paragraph';

const BLOCKS = [{ id: 'p1', type: 'paragraph', data: { text: 'hello' } }];

describe('controls-hidden wrapper attribute', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    core = undefined;
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (readOnly: boolean | { hideControls: boolean }): Promise<Core> => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
      readOnly: readOnly as never,
      data: { blocks: BLOCKS },
    });
    await core.isReady;

    return core;
  };

  const wrapper = (): Element => {
    const node = holder.querySelector(`[${DATA_ATTR.readonly}], [data-blok-interface]`) ?? holder.firstElementChild;

    if (node === null) {
      throw new Error('editor wrapper not rendered');
    }

    return node;
  };

  it('plain read-only keeps the gutter: readonly attr present, controls-hidden attr absent', async () => {
    await boot(true);

    expect(wrapper().hasAttribute(DATA_ATTR.readonly)).toBe(true);
    expect(wrapper().hasAttribute(DATA_ATTR.controlsHidden)).toBe(false);
  });

  it('readOnly with hideControls stamps controls-hidden at boot', async () => {
    await boot({ hideControls: true });

    expect(wrapper().hasAttribute(DATA_ATTR.controlsHidden)).toBe(true);
  });

  it('readOnly.set(true, { hideControls: true }) stamps it at runtime; hideControls: false removes it', async () => {
    const booted = await boot(false);
    const api = booted.moduleInstances.API.methods;

    await api.readOnly.set(true, { hideControls: true });
    expect(wrapper().hasAttribute(DATA_ATTR.controlsHidden)).toBe(true);

    await api.readOnly.set(true, { hideControls: false });
    expect(wrapper().hasAttribute(DATA_ATTR.controlsHidden)).toBe(false);
  });

  it('leaving read-only removes the attribute even when config kept hideControls', async () => {
    const booted = await boot({ hideControls: true });
    const api = booted.moduleInstances.API.methods;

    await api.readOnly.set(false);

    expect(wrapper().hasAttribute(DATA_ATTR.controlsHidden)).toBe(false);
  });
});
