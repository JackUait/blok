import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import { IconToggleH1, IconToggleH2, IconToggleH3 } from '../../../src/components/icons';
import { TOGGLE_ATTR } from '../../../src/tools/toggle/constants';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

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
  block: { id: 'test-block-id' } as never,
});

/**
 * Helper to convert MenuConfig to array for easier testing
 */
const toMenuArray = (config: MenuConfig): Array<Record<string, unknown>> => {
  return (Array.isArray(config) ? config : [config]) as Array<Record<string, unknown>>;
};

describe('Header Tool - Custom Configurations', () => {
  describe('placeholder configuration', () => {
    it('uses custom placeholder when provided', () => {
      const options = createHeaderOptions({}, { placeholder: 'Enter heading...' });
      const header = new Header(options);
      const element = header.render();

      expect(element).toHaveAttribute('data-placeholder', 'Enter heading...');
    });

    it('uses level name as placeholder when not provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const element = header.render();

      expect(element).toHaveAttribute('data-placeholder', 'Heading 2');
    });
  });


  describe('levels configuration', () => {
    it('restricts available levels when levels config is provided', () => {
      const options = createHeaderOptions({}, { levels: [1, 2, 3] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(3);
      expect(settings.filter(s => s.dataset !== undefined).map(s => s.dataset as Record<string, string>)).toEqual([
        { 'blok-header-level': '1' },
        { 'blok-header-level': '2' },
        { 'blok-header-level': '3' },
      ]);
    });

    it('shows all levels (1-6) when levels config is not provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(6);
    });

    it('only allows specified levels in settings', () => {
      const options = createHeaderOptions({}, { levels: [2, 4, 6] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(3);
    });
  });

  describe('defaultLevel configuration', () => {
    it('uses custom default level when no level is provided in data', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: { defaultLevel: 3 },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H3');
    });

    it('uses H2 as default when defaultLevel is not provided', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: {},
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H2');
    });

    it('falls back to H2 when specified defaultLevel is not in available levels', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: { levels: [1, 2], defaultLevel: 5 },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H2');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('respects level from data even when defaultLevel is configured', () => {
      const options = createHeaderOptions({ text: 'Test', level: 4 }, { defaultLevel: 1 });
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H4');
    });
  });


  describe('levelOverrides configuration', () => {
    it('applies custom tag override', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('DIV');
    });

    it('applies custom name override in settings', () => {
      const options = createHeaderOptions(
        {},
        {
          levelOverrides: {
            1: { name: 'Title' },
            2: { name: 'Subtitle' },
          },
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings[0].title).toBe('Title');
      expect(settings[1].title).toBe('Subtitle');
    });

    it('applies custom font size via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { size: '48px' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.fontSize).toBe('48px');
    });

    it('applies custom margin top via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        { levelOverrides: { 2: { marginTop: '2rem' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.marginTop).toBe('2rem');
    });

    it('applies custom margin bottom via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 3 },
        { levelOverrides: { 3: { marginBottom: '1.5rem' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.marginBottom).toBe('1.5rem');
    });

    it('applies multiple style overrides together', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        {
          levelOverrides: {
            1: { tag: 'p', size: '3em', marginTop: '20px', marginBottom: '10px' },
          },
        }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('P');
      expect(element.style.fontSize).toBe('3em');
      expect(element.style.marginTop).toBe('20px');
      expect(element.style.marginBottom).toBe('10px');
    });

    it('preserves default values when override is not provided', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 2: { size: '24px' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H1');
      expect(element.style.fontSize).toBe('');
    });
  });


  describe('combined configurations', () => {
    it('works with levels and levelOverrides together', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        {
          levels: [1, 2],
          levelOverrides: {
            1: { name: 'Main Title', size: '3rem' },
            2: { name: 'Section Title', size: '2rem' },
          },
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(2);
      expect(settings[0].title).toBe('Main Title');
      expect(settings[1].title).toBe('Section Title');
    });

    it('works with defaultLevel and levelOverrides together', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: {
          defaultLevel: 3,
          levelOverrides: { 3: { tag: 'div', size: '1.5rem' } },
        },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('DIV');
      expect(element.style.fontSize).toBe('1.5rem');
    });
  });

  describe('data handling', () => {
    it('preserves text content with custom configuration', () => {
      const options = createHeaderOptions(
        { text: '<b>Bold</b> text', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.innerHTML).toBe('<b>Bold</b> text');
    });

    it('saves data correctly with custom tag', () => {
      const options = createHeaderOptions(
        { text: 'Test content', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();
      const savedData = header.save(element);

      expect(savedData.text).toBe('Test content');
      expect(savedData.level).toBe(1);
    });
  });

  describe('read-only mode', () => {
    it('respects read-only mode with custom configuration', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        ...createHeaderOptions({ text: 'Test', level: 1 }, { levelOverrides: { 1: { tag: 'div' } } }),
        readOnly: true,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.contentEditable).toBe('false');
    });
  });

  describe('data-blok-tool attribute', () => {
    it('sets data-blok-tool attribute regardless of custom tag', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element).toHaveAttribute('data-blok-tool', 'header');
    });
  });

  describe('toggle heading (isToggleable)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('rendering', () => {
      it('renders a toggle arrow when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();
        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

        expect(arrow).not.toBeNull();
      });

      it('does NOT render a toggle arrow when isToggleable is false', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2, isToggleable: false });
        const header = new Header(options);
        const element = header.render();
        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

        expect(arrow).toBeNull();
      });

      it('does NOT render a toggle arrow when isToggleable is undefined', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2 });
        const header = new Header(options);
        const element = header.render();
        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

        expect(arrow).toBeNull();
      });

      it('starts open when isToggleable is true in editing mode', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const wrapper = header.render();
        // data-blok-toggle-open is on the heading element inside the wrapper
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);

        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
      });

      it('starts open when isToggleable is true in readOnly mode', () => {
        const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
          data: { text: 'Toggle Heading', level: 2, isToggleable: true } as HeaderData,
          config: {},
          api: createMockAPI(),
          readOnly: true,
          block: { id: 'test-block-id' } as never,
        };
        const header = new Header(options);
        const wrapper = header.render();
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);

        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
      });

      it('arrow element is outside the contenteditable heading (wrapper sibling)', () => {
        const options = createHeaderOptions({ text: 'Test', level: 2, isToggleable: true });
        const header = new Header(options);
        const wrapper = header.render();

        const arrow = wrapper.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
        const heading = wrapper.querySelector('h2') as HTMLElement;

        expect(arrow).not.toBeNull();
        expect(heading).not.toBeNull();
        // Arrow and heading must be siblings in the inner header row, not inside each other.
        // The outer wrapper's first child is the inner row (positioning context for the arrow).
        const headerRow = wrapper.children[0] as HTMLElement;
        expect(headerRow.children[0]).toBe(arrow);
        expect(headerRow.children[1]).toBe(heading);
        expect(heading.contains(arrow)).toBe(false);
      });

      it('marks wrapper data-blok-toggle-empty="true" when the toggle heading has no children', () => {
        const api = createMockAPI();
        const getChildren = api.blocks.getChildren as unknown as ReturnType<typeof vi.fn>;
        getChildren.mockReturnValue([]);
        const header = new Header({
          data: { text: 'Toggle Heading', level: 2, isToggleable: true } as HeaderData,
          config: {},
          api,
          readOnly: false,
          block: { id: 'test-block-id' } as never,
        });
        const wrapper = header.render();
        header.rendered();

        expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');
      });

      it('marks wrapper data-blok-toggle-empty="false" when a child block has text content', () => {
        const api = createMockAPI();
        const getChildren = api.blocks.getChildren as unknown as ReturnType<typeof vi.fn>;
        const childHolder = document.createElement('div');
        childHolder.textContent = 'Some body text';
        getChildren.mockReturnValue([{ holder: childHolder }]);
        const header = new Header({
          data: { text: 'Toggle Heading', level: 2, isToggleable: true } as HeaderData,
          config: {},
          api,
          readOnly: false,
          block: { id: 'test-block-id' } as never,
        });
        const wrapper = header.render();
        header.rendered();

        expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('false');
      });

      it('preserves heading text content when isToggleable is true', () => {
        const options = createHeaderOptions({ text: '<b>Bold</b> toggle heading', level: 1, isToggleable: true });
        const header = new Header(options);
        const element = header.render();

        expect(element.innerHTML).toContain('<b>Bold</b> toggle heading');
      });

      it('applies pl-8 padding to heading element when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const wrapper = header.render();
        const heading = wrapper.querySelector('h2') as HTMLElement;

        expect(heading).not.toBeNull();
        expect(heading.classList.contains('pl-8')).toBe(true);
        expect(heading.classList.contains('pl-7')).toBe(false);
      });

      it('does not apply pl-8 padding to heading element when isToggleable is false', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2, isToggleable: false });
        const header = new Header(options);
        const element = header.render();

        expect(element.classList.contains('pl-8')).toBe(false);
      });

      it('applies pl-8 to children container so body aligns with heading text start', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const wrapper = header.render();
        const childContainer = wrapper.querySelector('[data-blok-toggle-children]') as HTMLElement;

        expect(childContainer).not.toBeNull();
        expect(childContainer.classList.contains('pl-8')).toBe(true);
      });

      it('applies pl-8 to body placeholder so it aligns with heading text start', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const wrapper = header.render();
        const bodyPlaceholder = wrapper.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;

        expect(bodyPlaceholder).not.toBeNull();
        expect(bodyPlaceholder.classList.contains('pl-8')).toBe(true);
      });
    });

    describe('toggle arrow click', () => {
      /**
       * Creates a header with isToggleable and a mock API that returns child block holders.
       */
      const setupToggleHeaderWithChildren = (childCount = 2) => {
        const childHolders = Array.from({ length: childCount }, (_, i) => {
          const holder = document.createElement('div');
          holder.setAttribute('data-blok-element', '');
          holder.textContent = `Child ${i + 1}`;

          return holder;
        });

        const childBlocks = childHolders.map((holder, i) => ({
          id: `child-${i}`,
          holder,
        }));

        const mockAPI = createMockAPI();
        (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

        const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
          data: { text: 'Toggle Heading', level: 2, isToggleable: true } as HeaderData,
          config: {},
          api: mockAPI,
          readOnly: false,
          block: { id: 'test-block-id' } as never,
        };

        const header = new Header(options);

        return { header, mockAPI, childHolders };
      };

      it('collapses children when arrow is clicked (starts open), then re-expands on second click', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        const element = header.render();

        // Call rendered() to apply initial state
        header.rendered();

        // Verify children are visible initially (open by default)
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }

        // Click arrow to collapse
        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
        arrow.click();

        // Children should now be hidden
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }

        // Click arrow again to re-expand
        arrow.click();

        // Children should be visible again
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }
      });

      it('collapses children on first click (starts open)', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        const element = header.render();
        header.rendered();

        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

        // First click: collapse (starts open)
        arrow.click();
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }
      });

      it('rotates arrow SVG 90deg when expanded and resets when collapsed', () => {
        const { header } = setupToggleHeaderWithChildren();
        const element = header.render();
        header.rendered();

        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
        const svg = arrow.querySelector('svg') as SVGElement;

        // Initially open - SVG rotated 90deg
        expect(svg.style.transform).toBe('rotate(90deg)');

        // Click to collapse
        arrow.click();
        expect(svg.style.transform).toBe('');

        // Click to expand again
        arrow.click();
        expect(svg.style.transform).toBe('rotate(90deg)');
      });

      it('shows children on rendered() when toggle starts open by default', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        header.render();
        header.rendered();

        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }
      });
    });

    describe('save()', () => {
      it('preserves isToggleable: true in saved data', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();
        const savedData = header.save(element);

        expect(savedData.isToggleable).toBe(true);
      });

      it('does not include isToggleable when it is false', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2, isToggleable: false });
        const header = new Header(options);
        const element = header.render();
        const savedData = header.save(element);

        expect(savedData.isToggleable).toBeUndefined();
      });

      it('does not include isToggleable when it is undefined', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2 });
        const header = new Header(options);
        const element = header.render();
        const savedData = header.save(element);

        expect(savedData.isToggleable).toBeUndefined();
      });

      it('does not include arrow HTML in saved text when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();
        const savedData = header.save(element);

        expect(savedData.text).not.toContain(TOGGLE_ATTR.toggleArrow);
        expect(savedData.text).toBe('Toggle Heading');
      });

      it('does not mutate the live DOM during save (uses clone to strip arrow)', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();

        const arrowBefore = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

        // Arrow should exist before save
        expect(arrowBefore).not.toBeNull();

        // Spy on the live element to ensure remove() is never called on the arrow
        const removeSpy = vi.spyOn(arrowBefore!, 'remove');

        header.save(element);

        // Arrow should still exist after save — never removed from live DOM
        expect(element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`)).toBe(arrowBefore);
        expect(removeSpy).not.toHaveBeenCalled();
      });
    });

    describe('data getter does not include arrow HTML', () => {
      it('returns text without arrow HTML when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        header.render();

        const { text } = header.data;

        expect(text).not.toContain(TOGGLE_ATTR.toggleArrow);
        expect(text).toBe('Toggle Heading');
      });

      it('re-adds arrow element after reading data getter', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();

        // Arrow should exist before data access
        expect(element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`)).not.toBeNull();

        void header.data;

        // Arrow should still exist after data access
        expect(element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`)).not.toBeNull();
      });
    });

    describe('normalizeData strips arrow HTML from corrupted data', () => {
      it('strips previously saved arrow HTML from text', () => {
        const corruptedText = `<div ${TOGGLE_ATTR.toggleArrow}="" role="button">arrow</div>Clean text`;
        const options = createHeaderOptions({ text: corruptedText, level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();
        const savedData = header.save(element);

        expect(savedData.text).not.toContain(TOGGLE_ATTR.toggleArrow);
        expect(savedData.text).toBe('Clean text');
      });
    });

    describe('expand() and collapse() public methods', () => {
      /**
       * Creates a toggle heading with child blocks for testing expand/collapse.
       */
      const setupToggleHeaderForExpandCollapse = (childCount = 2) => {
        const childHolders = Array.from({ length: childCount }, (_, i) => {
          const holder = document.createElement('div');
          holder.textContent = `Child ${i + 1}`;

          return holder;
        });

        const childBlocks = childHolders.map((holder, i) => ({
          id: `child-${i}`,
          holder,
        }));

        const mockAPI = createMockAPI();
        (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

        const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
          data: { text: 'Toggle Heading', level: 2, isToggleable: true } as HeaderData,
          config: {},
          api: mockAPI,
          readOnly: false,
          block: { id: 'test-block-id' } as never,
        };

        const header = new Header(options);

        return { header, childHolders };
      };

      it('expand() is a no-op if already expanded (default state)', () => {
        const { header, childHolders } = setupToggleHeaderForExpandCollapse();
        const wrapper = header.render();
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);
        header.rendered();

        // Starts open by default
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }

        // Expand again - should remain expanded (no-op)
        header.expand();

        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }
      });

      it('expand() is a no-op if already expanded', () => {
        const { header, childHolders } = setupToggleHeaderForExpandCollapse();
        const wrapper = header.render();
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);
        header.rendered();

        header.expand();
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');

        // Expand again - should remain expanded
        header.expand();
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }
      });

      it('collapse() collapses an expanded toggle heading', () => {
        const { header, childHolders } = setupToggleHeaderForExpandCollapse();
        const wrapper = header.render();
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);
        header.rendered();

        // Expand first
        header.expand();
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');

        // Collapse via public method
        header.collapse();

        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }
      });

      it('collapse() collapses toggle heading from default open state', () => {
        const { header, childHolders } = setupToggleHeaderForExpandCollapse();
        const wrapper = header.render();
        const heading = wrapper.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);
        header.rendered();

        // Starts open by default
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');

        // Collapse via public method
        header.collapse();
        expect(heading?.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }
      });

      it('expand() is a no-op on a non-toggleable header', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2 });
        const header = new Header(options);
        header.render();

        // Should not throw and should be a no-op
        expect(() => header.expand()).not.toThrow();
      });

      it('collapse() is a no-op on a non-toggleable header', () => {
        const options = createHeaderOptions({ text: 'Normal Heading', level: 2 });
        const header = new Header(options);
        header.render();

        // Should not throw and should be a no-op
        expect(() => header.collapse()).not.toThrow();
      });
    });

    describe('data setter preserves isToggleable', () => {
      it('preserves isToggleable when level is changed via setLevel', () => {
        const options = createHeaderOptions({ text: 'Test', level: 2, isToggleable: true });
        const header = new Header(options);
        header.render();

        // Trigger setLevel through renderSettings onActivate
        const settings = toMenuArray(header.renderSettings());
        const h3Setting = settings.find(s => (s.dataset as Record<string, string>)?.['blok-header-level'] === '3');
        const onActivate = h3Setting?.onActivate as (() => void) | undefined;

        onActivate?.();

        const savedData = header.save(header.render());

        expect(savedData.level).toBe(3);
        expect(savedData.isToggleable).toBe(true);
      });
    });
  });

  describe('merge()', () => {
    it('does not inject arrow HTML from merged data text', () => {
      const options = createHeaderOptions({ text: 'Hello', level: 2, isToggleable: true });
      const header = new Header(options);
      header.render();

      // Simulate merging data that has corrupted arrow HTML
      const corruptedText = `<div ${TOGGLE_ATTR.toggleArrow}="" role="button">arrow</div> World`;
      header.merge({ text: corruptedText, level: 2 });

      const saved = header.save(header.render());

      expect(saved.text).not.toContain(TOGGLE_ATTR.toggleArrow);
      expect(saved.text).toContain('Hello');
      expect(saved.text).toContain('World');
    });

    it('appends text after existing content, not after arrow element', () => {
      const options = createHeaderOptions({ text: 'Hello', level: 2, isToggleable: true });
      const header = new Header(options);
      const wrapper = header.render();

      header.merge({ text: ' World', level: 2 });

      // Arrow is in the wrapper (sibling of heading), not inside the heading
      const heading = wrapper.querySelector('h2') as HTMLElement;
      expect(heading.innerHTML).toBe('Hello World');
    });
  });

  describe('static toolbox', () => {
    it('includes toggle heading entries for levels 1-3', () => {
      const toolbox = Header.toolbox;

      expect(Array.isArray(toolbox)).toBe(true);

      const entries = toolbox as Array<{ name: string; data: Record<string, unknown>; title: string }>;

      const toggleEntries = entries.filter(e => e.name.startsWith('toggle-header-'));

      expect(toggleEntries).toHaveLength(3);
      expect(toggleEntries[0].name).toBe('toggle-header-1');
      expect(toggleEntries[0].data).toEqual({ level: 1, isToggleable: true });
      expect(toggleEntries[1].name).toBe('toggle-header-2');
      expect(toggleEntries[1].data).toEqual({ level: 2, isToggleable: true });
      expect(toggleEntries[2].name).toBe('toggle-header-3');
      expect(toggleEntries[2].data).toEqual({ level: 3, isToggleable: true });
    });

    it('includes search terms for toggle heading entries', () => {
      const toolbox = Header.toolbox;
      const entries = toolbox as Array<{ name: string; searchTerms?: string[] }>;
      const toggleEntry = entries.find(e => e.name === 'toggle-header-1');

      expect(toggleEntry?.searchTerms).toContain('toggle');
      expect(toggleEntry?.searchTerms).toContain('collapsible');
    });

    it('uses dedicated icon constants for toggle heading entries', () => {
      const toolbox = Header.toolbox;
      const entries = toolbox as Array<{ name: string; icon: string }>;

      const toggleH1 = entries.find(e => e.name === 'toggle-header-1');
      const toggleH2 = entries.find(e => e.name === 'toggle-header-2');
      const toggleH3 = entries.find(e => e.name === 'toggle-header-3');

      expect(toggleH1?.icon).toBe(IconToggleH1);
      expect(toggleH2?.icon).toBe(IconToggleH2);
      expect(toggleH3?.icon).toBe(IconToggleH3);
    });

    it('toggle heading icons do not contain scale transforms', () => {
      const toolbox = Header.toolbox;
      const entries = toolbox as Array<{ name: string; icon: string }>;
      const toggleEntries = entries.filter(e => e.name.startsWith('toggle-header-'));

      for (const entry of toggleEntries) {
        expect(entry.icon).not.toContain('scale(');
        expect(entry.icon).not.toContain('<g transform');
      }
    });
  });
});

describe('Header Tool - Toggle heading body placeholder click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking body placeholder inserts a child paragraph at the correct index', () => {
    const mockNewBlock = { id: 'new-child-block' };
    const mockSetToBlock = vi.fn();
    const mockInsertInsideParent = vi.fn().mockReturnValue(mockNewBlock);
    const mockAPI = (() => {
      const api: API = {
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
        i18n: { t: (key: string) => key, has: () => false },
        blocks: {
          getChildren: vi.fn().mockReturnValue([]),
          getBlockIndex: vi.fn().mockReturnValue(2),
          insertInsideParent: mockInsertInsideParent,
        },
        events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      } as unknown as API;
      (api as unknown as Record<string, unknown>).caret = { setToBlock: mockSetToBlock };
      return api;
    })();

    const header = new Header({
      data: { text: 'My Toggle', level: 2, isToggleable: true } as HeaderData,
      config: {},
      api: mockAPI,
      readOnly: false,
      block: { id: 'test-block-id' } as never,
    });
    const wrapper = header.render();
    header.rendered();

    const bodyPlaceholder = wrapper.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;

    expect(bodyPlaceholder).not.toBeNull();

    bodyPlaceholder.click();

    // insertInsideParent(parentId, insertIndex) — index is getBlockIndex(2) + 1 = 3
    expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 3);
    expect(mockSetToBlock).toHaveBeenCalledWith('new-child-block', 'start');
  });

  it('clicking body placeholder hides the placeholder', () => {
    const mockNewBlock = { id: 'new-child-block' };
    const mockSetToBlock = vi.fn();
    const mockAPI = (() => {
      const api: API = {
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
        i18n: { t: (key: string) => key, has: () => false },
        blocks: {
          getChildren: vi.fn().mockReturnValue([]),
          getBlockIndex: vi.fn().mockReturnValue(0),
          insertInsideParent: vi.fn().mockReturnValue(mockNewBlock),
        },
        events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      } as unknown as API;
      (api as unknown as Record<string, unknown>).caret = { setToBlock: mockSetToBlock };
      return api;
    })();

    const header = new Header({
      data: { text: 'My Toggle', level: 2, isToggleable: true } as HeaderData,
      config: {},
      api: mockAPI,
      readOnly: false,
      block: { id: 'test-block-id' } as never,
    });
    const wrapper = header.render();
    header.rendered();

    const bodyPlaceholder = wrapper.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;

    expect(bodyPlaceholder).not.toBeNull();
    bodyPlaceholder.click();

    expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);
  });

  it('does not insert a block in read-only mode', () => {
    const mockInsertInsideParent = vi.fn();
    const mockAPI: API = {
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
      i18n: { t: (key: string) => key, has: () => false },
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        insertInsideParent: mockInsertInsideParent,
      },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    } as unknown as API;

    const header = new Header({
      data: { text: 'My Toggle', level: 2, isToggleable: true } as HeaderData,
      config: {},
      api: mockAPI,
      readOnly: true,
      block: { id: 'test-block-id' } as never,
    });
    const wrapper = header.render();
    header.rendered();

    const bodyPlaceholder = wrapper.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;

    expect(bodyPlaceholder).not.toBeNull();
    bodyPlaceholder.click();

    expect(mockInsertInsideParent).not.toHaveBeenCalled();
  });

  it('does not insert a block when blockId is undefined', () => {
    const mockInsertInsideParent = vi.fn();
    const mockAPI: API = {
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
      i18n: { t: (key: string) => key, has: () => false },
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        insertInsideParent: mockInsertInsideParent,
      },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    } as unknown as API;

    // No block id passed — use undefined cast to simulate missing block
    const header = new Header({
      data: { text: 'My Toggle', level: 2, isToggleable: true } as HeaderData,
      config: {},
      api: mockAPI,
      readOnly: false,
      block: undefined as never,
    });
    const wrapper = header.render();
    header.rendered();

    const bodyPlaceholder = wrapper.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;

    expect(bodyPlaceholder).not.toBeNull();
    bodyPlaceholder.click();

    expect(mockInsertInsideParent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG 1: Header has no setData() method — undo/redo on toggle headings
// triggers full DOM destruction instead of in-place update.
// ---------------------------------------------------------------------------
describe('Header Tool - setData() for undo/redo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createToggleHeader = (
    data: Partial<HeaderData> = {},
    overrides: { children?: Array<{ id: string; holder: HTMLElement }> } = {}
  ): { header: Header; api: API; wrapper: HTMLElement } => {
    const children = overrides.children ?? [];
    const api: API = {
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
      i18n: { t: (key: string) => key, has: () => false },
      blocks: {
        getChildren: vi.fn().mockReturnValue(children),
      },
      events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    } as unknown as API;

    const header = new Header({
      data: { text: 'Hello', level: 2, isToggleable: true, isOpen: true, ...data } as HeaderData,
      config: {},
      api,
      readOnly: false,
      block: { id: 'test-block-id' } as never,
    });

    const wrapper = header.render();
    header.rendered();

    return { header, api, wrapper };
  };

  it('setData updates heading text content', () => {
    const { header, wrapper } = createToggleHeader({ text: 'Original' });

    const result = header.setData({ text: 'Updated', level: 2, isToggleable: true, isOpen: true });

    const heading = wrapper.querySelector('h2') as HTMLElement;
    expect(heading.innerHTML).toBe('Updated');
    expect(result).toBe(true);
  });

  it('setData syncs _isOpen when isOpen changes from true to false', () => {
    const { header } = createToggleHeader({ isOpen: true });

    header.setData({ text: 'Hello', level: 2, isToggleable: true, isOpen: false });

    const saved = header.save(document.createElement('div'));
    expect(saved.isOpen).toBe(false);
  });

  it('setData syncs _isOpen when isOpen changes from false to true', () => {
    const { header } = createToggleHeader({ isOpen: false });

    header.setData({ text: 'Hello', level: 2, isToggleable: true, isOpen: true });

    const saved = header.save(document.createElement('div'));
    expect(saved.isOpen).toBe(true);
  });

  it('setData updates wrapper data-blok-toggle-open attribute', () => {
    const { header, wrapper } = createToggleHeader({ isOpen: true });

    const heading = wrapper.querySelector('h2') as HTMLElement;
    expect(heading.getAttribute('data-blok-toggle-open')).toBe('true');

    header.setData({ text: 'Hello', level: 2, isToggleable: true, isOpen: false });

    expect(heading.getAttribute('data-blok-toggle-open')).toBe('false');
  });

  it('setData updates arrow aria-expanded attribute', () => {
    const { header, wrapper } = createToggleHeader({ isOpen: true });

    const arrow = wrapper.querySelector('[data-blok-toggle-arrow]') as HTMLElement;
    expect(arrow.getAttribute('aria-expanded')).toBe('true');

    header.setData({ text: 'Hello', level: 2, isToggleable: true, isOpen: false });

    expect(arrow.getAttribute('aria-expanded')).toBe('false');
  });

  it('setData returns true for successful in-place update', () => {
    const { header } = createToggleHeader();

    const result = header.setData({ text: 'New text', level: 2, isToggleable: true, isOpen: true });

    expect(result).toBe(true);
  });
});

describe('Header Tool - setReadOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setReadOnly', () => {
    it('sets contentEditable to false when entering readonly', () => {
      const options = createHeaderOptions({ text: 'Hello', level: 2 });
      const header = new Header(options);
      const element = header.render();

      header.setReadOnly(true);

      const heading = element.querySelector('h2') ?? element;

      expect(heading.contentEditable).toBe('false');
    });

    it('sets contentEditable to true when exiting readonly', () => {
      const options = createHeaderOptions({ text: 'Hello', level: 2 });

      (options as { readOnly: boolean }).readOnly = true;

      const header = new Header(options);
      const element = header.render();

      header.setReadOnly(false);

      const heading = element.querySelector('h2') ?? element;

      expect(heading.contentEditable).toBe('true');
    });

    it('preserves DOM element reference across toggle', () => {
      const options = createHeaderOptions({ text: 'Hello', level: 2 });
      const header = new Header(options);
      const element = header.render();

      header.setReadOnly(true);
      header.setReadOnly(false);

      expect(header.render()).toBe(element);
    });
  });
});

describe('Header Tool - Notion-matching typography', () => {
  it('H1 uses text-3xl font size (30px) matching Notion heading 1', () => {
    const options = createHeaderOptions({ text: 'Test', level: 1 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('text-3xl');
  });

  it('H2 uses text-2xl font size (24px) matching Notion heading 2', () => {
    const options = createHeaderOptions({ text: 'Test', level: 2 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('text-2xl');
  });

  it('H3 uses text-xl font size (20px) matching Notion heading 3', () => {
    const options = createHeaderOptions({ text: 'Test', level: 3 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('text-xl');
  });

  it('H4 uses text-lg font size (18px) to maintain hierarchy below H3', () => {
    const options = createHeaderOptions({ text: 'Test', level: 4 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('text-lg');
  });

  it('H2 uses mt-[26px] top margin matching Notion (1.1em × 24px = 26.4px)', () => {
    const options = createHeaderOptions({ text: 'Test', level: 2 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('mt-[26px]');
  });

  it('H3 uses mt-5 top margin matching Notion (1em × 20px = 20px)', () => {
    const options = createHeaderOptions({ text: 'Test', level: 3 });
    const header = new Header(options);
    const element = header.render();

    expect(element.className).toContain('mt-5');
  });

  it('H1 uses font-semibold (600) to match Notion heading font-weight: 600', () => {
    const options = createHeaderOptions({ text: 'Test', level: 1 });
    const header = new Header(options);
    const element = header.render();
    const classes = element.className.split(/\s+/);

    expect(classes).toContain('font-semibold');
    expect(classes).not.toContain('font-bold');
  });

  it('H1 uses mb-px (1px) to match Notion heading margin-bottom: 1px', () => {
    const options = createHeaderOptions({ text: 'Test', level: 1 });
    const header = new Header(options);
    const element = header.render();
    const classes = element.className.split(/\s+/);

    expect(classes).toContain('mb-px');
    expect(classes).not.toContain('mb-1');
  });
});
