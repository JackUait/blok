import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { renderListItem } from '../../../../src/tools/list/list-lifecycle';
import type { ListItemData } from '../../../../src/tools/list/types';

interface Rendered {
  wrapper: HTMLElement;
  checkbox: HTMLInputElement | null;
  content: HTMLElement | null;
  setupItemPlaceholder: ReturnType<typeof vi.fn>;
  onCheckboxChange: ReturnType<typeof vi.fn>;
}

interface RenderOptions {
  style?: ListItemData['style'];
  checked?: boolean;
  readOnly?: boolean;
}

const render = ({ style = 'unordered', checked = false, readOnly = false }: RenderOptions = {}): Rendered => {
  const setupItemPlaceholder = vi.fn();
  const onCheckboxChange = vi.fn();
  const wrapper = renderListItem({
    data: { text: 'item', style, checked, depth: 0 },
    readOnly,
    placeholder: 'List item',
    itemColor: undefined,
    itemSize: undefined,
    setupItemPlaceholder,
    onCheckboxChange,
    keydownHandler: undefined,
  });

  document.body.appendChild(wrapper);

  return {
    wrapper,
    checkbox: wrapper.querySelector('input[type="checkbox"]'),
    content: wrapper.querySelector('[data-blok-testid="list-checklist-content"]')
      ?? wrapper.querySelector('[data-blok-testid="list-content-container"]'),
    setupItemPlaceholder,
    onCheckboxChange,
  };
};

describe('list lifecycle mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hands back the built wrapper, not an inner element', () => {
    const { wrapper } = render();

    expect(wrapper).toBeInstanceOf(HTMLElement);
    expect(wrapper.querySelector('[data-blok-testid="list-content-container"]')).not.toBeNull();
  });

  it('sets the placeholder up on the content element, not the wrapper', () => {
    const { content, setupItemPlaceholder } = render();

    expect(setupItemPlaceholder).toHaveBeenCalledTimes(1);
    expect(setupItemPlaceholder.mock.calls[0][0]).toBe(content);
  });

  it('builds no checkbox for a plain list', () => {
    const { checkbox, onCheckboxChange } = render();

    expect(checkbox).toBeNull();
    expect(onCheckboxChange).not.toHaveBeenCalled();
  });

  describe('a checklist item', () => {
    it('reports a tick and marks its content', () => {
      const { checkbox, content, onCheckboxChange } = render({ style: 'checklist' });

      expect(checkbox).not.toBeNull();

      if (checkbox === null) {
        return;
      }

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(onCheckboxChange).toHaveBeenCalledWith(true, content);
      expect(content?.getAttribute('data-checked')).toBe('true');
    });

    it('reports an untick and clears the marking', () => {
      const { checkbox, content, onCheckboxChange } = render({ style: 'checklist', checked: true });

      if (checkbox === null) {
        throw new Error('no checkbox');
      }

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(onCheckboxChange).toHaveBeenCalledWith(false, content);
      expect(content?.getAttribute('data-checked')).toBe('false');
    });

    it('wires no change handler while read-only', () => {
      const { checkbox, onCheckboxChange } = render({ style: 'checklist', readOnly: true });

      if (checkbox === null) {
        throw new Error('no checkbox');
      }

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(onCheckboxChange).not.toHaveBeenCalled();
    });
  });
});
