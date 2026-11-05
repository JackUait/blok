import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncContentDirection } from '../../../../src/components/block/content-direction';

/** A block holder whose tool root holds `fields` editable fields with `text` each. */
const blockWith = (fields: number, text: string): { holder: HTMLElement; content: HTMLElement; root: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const root = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  root.innerHTML = Array.from({ length: fields }, () => `<div contenteditable="true">${text}</div>`).join('');
  content.appendChild(root);
  holder.appendChild(content);
  document.body.appendChild(holder);

  return { holder, content, root };
};

describe('syncContentDirection cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not inspect each field of a block whose text has no strong letter (an empty 100x100 table)', () => {
    const { holder, content, root } = blockWith(50, '12 ');
    const closest = vi.spyOn(Element.prototype, 'closest');

    content.setAttribute('dir', 'rtl');
    syncContentDirection(content, root, holder, false);

    expect(closest).not.toHaveBeenCalled();
    expect(content.hasAttribute('dir')).toBe(false);
  });

  it('still reads the direction from the first strong letter', () => {
    const { holder, content, root } = blockWith(2, 'مرحبا');

    syncContentDirection(content, root, holder, false);

    expect(content.getAttribute('dir')).toBe('rtl');
  });
});
