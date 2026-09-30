import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPreviewGallery } from '../../../src/playground/preview-gallery';

const draw = (text: string) => (): HTMLElement => {
  const el = document.createElement('div');

  el.setAttribute('data-blok-preview', text);
  el.textContent = text;

  return el;
};

class Solo {
  public static get toolbox(): unknown {
    return { titleKey: 'solo', preview: { render: draw('solo'), descriptionKey: 'toolbox.preview.text' } };
  }
}

class Many {
  public static get toolbox(): unknown {
    return [
      { name: 'many-1', title: 'Many one', preview: { render: draw('one'), description: 'First' } },
      { name: 'many-2', title: 'Many two' },
    ];
  }
}

describe('renderPreviewGallery', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('draws one card per toolbox entry that has a preview', () => {
    renderPreviewGallery({ container, tools: { Solo, Many }, translate: (key) => `t(${key})` });

    const cards = container.querySelectorAll('[data-blok-interface="block-preview"] [data-blok-preview-card]');

    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('[data-blok-preview="solo"]')).not.toBeNull();
    expect(cards[0].querySelector('[data-blok-preview-caption]')?.textContent).toBe('t(toolbox.preview.text)');
    expect(cards[1].querySelector('[data-blok-preview-caption]')?.textContent).toBe('First');
  });

  it('labels each card with its entry', () => {
    renderPreviewGallery({ container, tools: { Solo, Many }, translate: (key) => key });

    const labels = [...container.querySelectorAll('[data-preview-gallery-label]')].map((el) => el.textContent);

    expect(labels).toEqual(['Solo · solo', 'Many · many-1']);
  });
});
