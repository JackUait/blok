import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import { TOGGLE_ATTR } from '../../../src/tools/toggle/constants';
import type { API, BlockToolConstructorOptions, ToolboxConfigEntry } from '../../../types';
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

    it('uses empty placeholder when not provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const element = header.render();

      expect(element).toHaveAttribute('data-placeholder', '');
    });
  });


  describe('levels configuration', () => {
    it('restricts available levels when levels config is provided', () => {
      const options = createHeaderOptions({}, { levels: [1, 2, 3] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 3 levels + 1 toggle heading option
      expect(settings).toHaveLength(4);
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

      // 6 levels + 1 toggle heading option
      expect(settings).toHaveLength(7);
    });

    it('only allows specified levels in settings', () => {
      const options = createHeaderOptions({}, { levels: [2, 4, 6] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 3 levels + 1 toggle heading option
      expect(settings).toHaveLength(4);
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

      // 2 levels + 1 toggle heading option
      expect(settings).toHaveLength(3);
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

  describe('_toolboxEntries configuration', () => {
    it('uses custom toolbox entries when _toolboxEntries is provided', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { icon: '<svg>H2</svg>', title: 'Big Heading', data: { level: 2 } },
        { icon: '<svg>H3</svg>', title: 'Medium Heading', data: { level: 3 } },
        { icon: '<svg>H4</svg>', title: 'Small Heading', data: { level: 4 } },
      ];
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        { _toolboxEntries: toolboxEntries }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 3 toolbox entries + 1 toggle heading option
      expect(settings).toHaveLength(4);
      expect(settings[0].title).toBe('Big Heading');
      expect(settings[0].icon).toBe('<svg>H2</svg>');
      expect(settings[1].title).toBe('Medium Heading');
      expect(settings[2].title).toBe('Small Heading');
    });

    it('shows correct levels based on toolbox entry data', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'H2', data: { level: 2 } },
        { title: 'H4', data: { level: 4 } },
      ];
      const options = createHeaderOptions({}, { _toolboxEntries: toolboxEntries });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 2 toolbox entries + 1 toggle heading option
      expect(settings).toHaveLength(3);
      expect(settings.filter(s => s.dataset !== undefined).map(s => s.dataset as Record<string, string>)).toEqual([
        { 'blok-header-level': '2' },
        { 'blok-header-level': '4' },
      ]);
    });

    it('falls back to levels config when _toolboxEntries is not provided', () => {
      const options = createHeaderOptions({}, { levels: [1, 2, 3] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 3 levels + 1 toggle heading option
      expect(settings).toHaveLength(4);
    });

    it('falls back to all levels when neither _toolboxEntries nor levels is provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 6 levels + 1 toggle heading option
      expect(settings).toHaveLength(7);
    });

    it('marks correct level as active with custom toolbox entries', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'H2', data: { level: 2 } },
        { title: 'H3', data: { level: 3 } },
      ];
      const options = createHeaderOptions(
        { text: 'Test', level: 3 },
        { _toolboxEntries: toolboxEntries }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings[0].isActive).toBe(false);
      expect(settings[1].isActive).toBe(true);
    });

    it('uses default icon when not provided in toolbox entry', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'Custom H2', data: { level: 2 } },
      ];
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        { _toolboxEntries: toolboxEntries }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings[0].title).toBe('Custom H2');
      expect(settings[0].icon).toBeDefined();
      expect(typeof settings[0].icon).toBe('string');
      expect((settings[0].icon as string).length).toBeGreaterThan(0);
    });

    it('uses default title when not provided in toolbox entry', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { icon: '<svg>custom</svg>', data: { level: 2 } },
      ];
      const options = createHeaderOptions({}, { _toolboxEntries: toolboxEntries });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings[0].title).toBe('Heading 2');
      expect(settings[0].icon).toBe('<svg>custom</svg>');
    });

    it('uses default level when data.level is not provided in toolbox entry', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'Default Level' },
      ];
      const options = createHeaderOptions({}, { _toolboxEntries: toolboxEntries, defaultLevel: 3 });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 1 toolbox entry + 1 toggle heading option
      expect(settings).toHaveLength(2);
      expect(settings[0].dataset).toEqual({ 'blok-header-level': '3' });
    });

    it('ignores levels config when _toolboxEntries is provided', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'Only H2', data: { level: 2 } },
      ];
      const options = createHeaderOptions(
        {},
        {
          _toolboxEntries: toolboxEntries,
          levels: [1, 2, 3, 4, 5, 6],
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 1 toolbox entry + 1 toggle heading option
      expect(settings).toHaveLength(2);
      expect(settings[0].title).toBe('Only H2');
    });

    it('handles empty _toolboxEntries array by falling back to levels config', () => {
      const options = createHeaderOptions(
        {},
        {
          _toolboxEntries: [],
          levels: [1, 2],
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      // 2 levels + 1 toggle heading option
      expect(settings).toHaveLength(3);
    });

    it('calls setLevel with correct level when onActivate is triggered', () => {
      const toolboxEntries: ToolboxConfigEntry[] = [
        { title: 'H3', data: { level: 3 } },
      ];
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        { _toolboxEntries: toolboxEntries }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      const onActivate = settings[0].onActivate as () => void;

      onActivate();

      // Check data.level changed (element replacement only happens when in DOM)
      const savedData = header.save(header.render());

      expect(savedData.level).toBe(3);
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

      it('starts collapsed when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Toggle Heading', level: 2, isToggleable: true });
        const header = new Header(options);
        const element = header.render();

        expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
      });

      it('preserves heading text content when isToggleable is true', () => {
        const options = createHeaderOptions({ text: '<b>Bold</b> toggle heading', level: 1, isToggleable: true });
        const header = new Header(options);
        const element = header.render();

        expect(element.innerHTML).toContain('<b>Bold</b> toggle heading');
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
        (mockAPI.blocks as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

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

      it('expands children when arrow is clicked', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        const element = header.render();

        // Call rendered() to trigger initial collapse
        header.rendered();

        // Verify children are hidden initially
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }

        // Click arrow to expand
        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
        arrow.click();

        // Children should now be visible
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }
      });

      it('collapses children when arrow is clicked again after expanding', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        const element = header.render();
        header.rendered();

        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

        // Expand
        arrow.click();
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(false);
        }

        // Collapse
        arrow.click();
        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
        }
      });

      it('rotates arrow 90deg when expanded', () => {
        const { header } = setupToggleHeaderWithChildren();
        const element = header.render();
        header.rendered();

        const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

        // Initially collapsed - no rotation
        expect(arrow.style.transform).toBe('');

        // Click to expand
        arrow.click();
        expect(arrow.style.transform).toBe('rotate(90deg)');

        // Click to collapse
        arrow.click();
        expect(arrow.style.transform).toBe('');
      });

      it('hides children on rendered() when toggle is collapsed', () => {
        const { header, childHolders } = setupToggleHeaderWithChildren();
        header.render();
        header.rendered();

        for (const holder of childHolders) {
          expect(holder.classList.contains('hidden')).toBe(true);
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
    });

    describe('renderSettings()', () => {
      it('includes a toggle heading option in settings', () => {
        const options = createHeaderOptions({ text: 'Test', level: 2 });
        const header = new Header(options);
        const settings = toMenuArray(header.renderSettings());
        const toggleSetting = settings.find(s => s.title === 'Toggle heading');

        expect(toggleSetting).toBeDefined();
      });

      it('toggle heading setting is active when isToggleable is true', () => {
        const options = createHeaderOptions({ text: 'Test', level: 2, isToggleable: true });
        const header = new Header(options);
        const settings = toMenuArray(header.renderSettings());
        const toggleSetting = settings.find(s => s.title === 'Toggle heading');

        expect(toggleSetting?.isActive).toBe(true);
      });

      it('toggle heading setting is not active when isToggleable is false', () => {
        const options = createHeaderOptions({ text: 'Test', level: 2, isToggleable: false });
        const header = new Header(options);
        const settings = toMenuArray(header.renderSettings());
        const toggleSetting = settings.find(s => s.title === 'Toggle heading');

        expect(toggleSetting?.isActive).toBe(false);
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
  });
});
