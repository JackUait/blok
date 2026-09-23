import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import {
  areSourceRootsChildrenOf,
  isCollapsedToggleBlock,
  isOpenToggleBlock,
  isToggleBlock,
} from '../../../../../../src/components/modules/drag/utils/toggleState';

const holderWith = (): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return holder;
};

const stub = (id: string, parentId: string | null = null, holder = holderWith()): Block =>
  ({ id, parentId, holder }) as unknown as Block;

/** Toggle heading shape: marker on the heading inside the row, children after the row. */
const toggleHeading = (id: string, open: boolean, nested: Block[] = []): Block => {
  const block = stub(id);
  const wrapper = document.createElement('div');
  const row = document.createElement('div');
  const heading = document.createElement('h2');
  const children = document.createElement('div');

  heading.setAttribute('data-blok-toggle-open', String(open));
  children.setAttribute('data-blok-toggle-children', '');
  nested.forEach(child => children.appendChild(child.holder));
  row.appendChild(heading);
  wrapper.append(row, children);
  block.holder.appendChild(wrapper);

  return block;
};

describe('toggleState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a collapsed toggle heading as collapsed even when a nested toggle is open', () => {
    const inner = toggleHeading('inner', true);
    const outer = toggleHeading('outer', false, [inner]);

    expect(isOpenToggleBlock(outer)).toBe(false);
    expect(isCollapsedToggleBlock(outer)).toBe(true);
    expect(isOpenToggleBlock(inner)).toBe(true);
  });

  it('does not treat a container as a toggle because it holds one', () => {
    const inner = toggleHeading('inner', false);
    const callout = stub('callout');

    callout.holder.appendChild(inner.holder);

    expect(isToggleBlock(callout)).toBe(false);
    expect(isCollapsedToggleBlock(callout)).toBe(false);
  });

  describe('areSourceRootsChildrenOf', () => {
    it('ignores descendants carried by a dragged root', () => {
      expect(areSourceRootsChildrenOf([stub('inner', 'outer'), stub('leaf', 'inner')], 'outer')).toBe(true);
    });

    it('is false when any root lives elsewhere', () => {
      expect(areSourceRootsChildrenOf([stub('inner', 'outer'), stub('loose')], 'outer')).toBe(false);
    });

    it('is false for no sources', () => {
      expect(areSourceRootsChildrenOf([], 'outer')).toBe(false);
    });

    it('reads parents through the given reader', () => {
      const moved = stub('inner', null);

      expect(areSourceRootsChildrenOf([moved], 'outer', () => 'outer')).toBe(true);
    });
  });
});
