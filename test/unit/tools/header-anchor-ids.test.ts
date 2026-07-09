import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import type { API, BlockToolConstructorOptions } from '../../../types';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: {
    t: (key: string) => key,
    has: () => false,
  },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    setBlockParent: vi.fn(),
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
} as unknown as API);

const createHeaderOptions = (
  data: Partial<HeaderData> = {},
  config: HeaderConfig = {}
): BlockToolConstructorOptions<HeaderData, HeaderConfig> => ({
  data: { text: '', level: 2, ...data } as HeaderData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'test-block-id', dispatchChange: vi.fn() } as never,
});

/**
 * Resolve the actual heading element from a rendered tool view.
 * For toggle headings render() returns a wrapper div, the heading lives inside.
 */
const getHeadingElement = (rendered: HTMLElement): HTMLElement => {
  if (/^H[1-6]$/.test(rendered.tagName)) {
    return rendered;
  }

  const heading = rendered.querySelector('h1, h2, h3, h4, h5, h6');

  if (!(heading instanceof HTMLElement)) {
    throw new Error('Heading element not found in rendered view');
  }

  return heading;
};

describe('Header Tool - anchorIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('disabled by default', () => {
    it('does not set an id when the option is absent', () => {
      const header = new Header(createHeaderOptions({ text: 'Обучайте команду' }));
      const element = getHeadingElement(header.render());

      expect(element.hasAttribute('id')).toBe(false);
    });

    it('does not set an id when the option is explicitly false', () => {
      const header = new Header(createHeaderOptions({ text: 'Hello world' }, { anchorIds: false }));
      const element = getHeadingElement(header.render());

      expect(element.hasAttribute('id')).toBe(false);
    });
  });

  describe('built-in slugifier (anchorIds: true)', () => {
    it('derives a Cyrillic id joining words with hyphens', () => {
      const header = new Header(createHeaderOptions({ text: 'Обучайте команду' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Обучайте-команду');
    });

    it('preserves letter case', () => {
      const header = new Header(
        createHeaderOptions({ text: 'Определите и Обучите Ответственного' }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Определите-и-Обучите-Ответственного');
    });

    it('strips punctuation but keeps Unicode letters and digits', () => {
      const header = new Header(
        createHeaderOptions({ text: 'Шаг 1: проверьте, всё ли готово?!' }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Шаг-1-проверьте-всё-ли-готово');
    });

    it('treats intra-word punctuation as a word separator', () => {
      const header = new Header(
        createHeaderOptions(
          { text: 'Обеспечьте эвакуационный/запасной выход' },
          { anchorIds: true }
        )
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Обеспечьте-эвакуационный-запасной-выход');
    });

    it('collapses whitespace runs into a single hyphen and trims', () => {
      const header = new Header(
        createHeaderOptions({ text: '  Hello   big\t world  ' }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Hello-big-world');
    });

    it('strips zero-width characters', () => {
      const header = new Header(
        createHeaderOptions({ text: 'Обу​чайте ‍команду﻿' }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Обучайте-команду');
    });

    it('uses plain text content, ignoring inline HTML markup', () => {
      const header = new Header(
        createHeaderOptions({ text: '<b>Bold</b> and <i>italic</i>' }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Bold-and-italic');
    });

    it('sets no id when the text is empty', () => {
      const header = new Header(createHeaderOptions({ text: '' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      expect(element.hasAttribute('id')).toBe(false);
    });

    it('sets no id when the text is punctuation-only', () => {
      const header = new Header(createHeaderOptions({ text: '?!…—' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      expect(element.hasAttribute('id')).toBe(false);
    });
  });

  describe('custom generator function', () => {
    it('uses the returned value as the id and passes text plus blockId', () => {
      const generator = vi.fn((text: string, blockId: string) => `custom-${blockId}-${text.length}`);
      const header = new Header(createHeaderOptions({ text: 'Hello' }, { anchorIds: generator }));
      const element = getHeadingElement(header.render());

      expect(generator).toHaveBeenCalledWith('Hello', 'test-block-id');
      expect(element.id).toBe('custom-test-block-id-5');
    });

    it('sets no id when the generator returns an empty string', () => {
      const header = new Header(createHeaderOptions({ text: 'Hello' }, { anchorIds: () => '' }));
      const element = getHeadingElement(header.render());

      expect(element.hasAttribute('id')).toBe(false);
    });
  });

  describe('id stays in sync', () => {
    it('re-derives the id after the heading text changes (updated lifecycle)', () => {
      const header = new Header(createHeaderOptions({ text: 'Before edit' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      expect(element.id).toBe('Before-edit');

      element.innerHTML = 'After edit';
      header.updated();

      expect(element.id).toBe('After-edit');
    });

    it('removes the id when the text becomes empty', () => {
      const header = new Header(createHeaderOptions({ text: 'Something' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      element.innerHTML = '';
      header.updated();

      expect(element.hasAttribute('id')).toBe(false);
    });

    it('survives a level change (element rebuild via data setter)', () => {
      const header = new Header(createHeaderOptions({ text: 'Stable anchor', level: 2 }, { anchorIds: true }));
      const element = getHeadingElement(header.render());
      const host = document.createElement('div');

      host.appendChild(element);

      header.data = { text: 'Stable anchor', level: 3 };

      const rebuilt = host.querySelector('h3');

      expect(rebuilt).not.toBeNull();
      expect(rebuilt?.id).toBe('Stable-anchor');
    });

    it('applies the id when data is replaced via setData (Yjs path)', () => {
      const header = new Header(createHeaderOptions({ text: 'Original' }, { anchorIds: true }));
      const element = getHeadingElement(header.render());

      header.setData({ text: 'Replaced text', level: 2 });

      expect(element.id).toBe('Replaced-text');
    });
  });

  describe('toggle headings', () => {
    it('sets the id on the heading element inside the toggle wrapper', () => {
      const header = new Header(
        createHeaderOptions({ text: 'Toggle заголовок', isToggleable: true }, { anchorIds: true })
      );
      const rendered = header.render();
      const element = getHeadingElement(rendered);

      expect(rendered.tagName).toBe('DIV');
      expect(element.id).toBe('Toggle-заголовок');
    });

    it('keeps the toggle heading id in sync after text change', () => {
      const header = new Header(
        createHeaderOptions({ text: 'До правки', isToggleable: true }, { anchorIds: true })
      );
      const element = getHeadingElement(header.render());

      element.innerHTML = 'После правки';
      header.updated();

      expect(element.id).toBe('После-правки');
    });
  });
});
