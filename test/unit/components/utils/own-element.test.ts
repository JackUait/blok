import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findOwn } from '../../../../src/components/utils/own-element';

const makeHolder = (): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return holder;
};

/** Toggle shape: marker on the tool root, child holders inside its slot. */
const makeToggle = (open: boolean, children: HTMLElement[] = []): HTMLElement => {
  const holder = makeHolder();
  const root = document.createElement('div');
  const slot = document.createElement('div');

  root.setAttribute('data-blok-toggle-open', String(open));
  slot.setAttribute('data-blok-toggle-children', '');
  slot.append(...children);
  root.appendChild(slot);
  holder.appendChild(root);

  return holder;
};

/** Callout shape: no marker of its own, child holders inside its slot. */
const makeCallout = (children: HTMLElement[]): HTMLElement => {
  const holder = makeHolder();
  const slot = document.createElement('div');

  slot.setAttribute('data-blok-toggle-children', '');
  slot.append(...children);
  holder.appendChild(slot);

  return holder;
};

describe('findOwn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips a nested block\'s marker that matches a value selector the block itself does not', () => {
    const holder = makeToggle(true, [makeToggle(false)]);

    expect(findOwn(holder, '[data-blok-toggle-open="false"]')).toBeNull();
  });

  it('returns null for a container whose only marker belongs to a child', () => {
    const holder = makeCallout([makeToggle(true)]);

    expect(findOwn(holder, '[data-blok-toggle-open]')).toBeNull();
  });

  it('returns the block\'s own marker when it has one', () => {
    const holder = makeToggle(false, [makeToggle(true)]);
    const own = holder.firstElementChild;

    expect(findOwn(holder, '[data-blok-toggle-open]')).toBe(own);
  });

  it('finds an own element that comes after a nested block in document order', () => {
    const holder = makeCallout([makeToggle(true)]);
    const ownAfter = document.createElement('span');

    ownAfter.setAttribute('data-blok-toggle-open', 'false');
    holder.appendChild(ownAfter);

    expect(findOwn(holder, '[data-blok-toggle-open]')).toBe(ownAfter);
  });

  it('treats a selector that matches a nested holder as the child\'s', () => {
    const holder = makeCallout([makeHolder()]);

    expect(findOwn(holder, '[data-blok-element]')).toBeNull();
  });

  it('owns everything no nested holder claims when the holder lacks the holder attribute', () => {
    const holder = document.createElement('div');
    const marker = document.createElement('div');

    marker.setAttribute('data-blok-toggle-open', 'true');
    holder.appendChild(marker);

    expect(findOwn(holder, '[data-blok-toggle-open]')).toBe(marker);
  });
});
