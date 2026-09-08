import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToolRenderer } from '../../../../src/components/block/tool-renderer';
import type { TunesManager } from '../../../../src/components/block/tunes-manager';
import { BLOCK_CONTENT_CLASSES, BLOCK_WRAPPER_CLASSES } from '../../../../src/shared/block-scaffolding';
import type { BlockTool } from '@/types';

/**
 * The exact class list `addToolDataAttributes` stamps on a tool root that owns
 * a placeholder. Order matters: it is asserted as produced, so an emptied array
 * or a dropped `classList.add` cannot hide behind a partial check.
 */
const PLACEHOLDER_CLASSES = [
  'empty:before:pointer-events-none',
  'empty:before:text-block-placeholder',
  'empty:before:cursor-text',
  'empty:before:content-[attr(data-blok-placeholder)]',
  'empty:before:inline-block',
  'empty:before:w-0',
  'empty:before:whitespace-nowrap',
  'data-[blok-empty=true]:before:pointer-events-none',
  'data-[blok-empty=true]:before:text-block-placeholder',
  'data-[blok-empty=true]:before:cursor-text',
  'data-[blok-empty=true]:before:content-[attr(data-blok-placeholder)]',
  'data-[blok-empty=true]:before:inline-block',
  'data-[blok-empty=true]:before:w-0',
  'data-[blok-empty=true]:before:whitespace-nowrap',
];

/**
 * Placeholder-bearing slice of a tool config.
 */
interface PlaceholderConfig {
  placeholder?: string | false;
}

/**
 * Inputs for a one-line ToolRenderer fixture.
 */
interface RendererOptions {
  name?: string;
  render: () => HTMLElement | Promise<HTMLElement>;
  rendered?: () => void;
  config?: PlaceholderConfig;
}

/**
 * Every attribute an element carries, read back from the DOM.
 * @param element - element to inspect
 */
const attributesOf = (element: Element): Record<string, string> => {
  const map: Record<string, string> = {};

  for (const attribute of Array.from(element.attributes)) {
    map[attribute.name] = attribute.value;
  }

  return map;
};

/**
 * Waits one macrotask, which is long enough for the async render chain
 * (`.then` / `.catch`) to have run.
 */
const flushTasks = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

/**
 * Waits for the frame the `rendered()` lifecycle is deferred to.
 */
const flushFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => {
    resolve();
  });
});

describe('ToolRenderer mutants', () => {
  let tunesManager: TunesManager;

  /**
   * Builds a renderer over a stub tool.
   * @param options - tool name, render result, optional rendered() and config
   */
  const createRenderer = (options: RendererOptions): ToolRenderer => {
    const tool: BlockTool = {
      render: options.render,
      save: () => ({ text: 'content' }),
      ...(options.rendered === undefined ? {} : { rendered: options.rendered }),
    };

    return new ToolRenderer(
      tool,
      options.name ?? 'header',
      'block-id',
      tunesManager,
      options.config ?? {}
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    tunesManager = {
      wrapContent: vi.fn((content: HTMLElement) => content),
    } as unknown as TunesManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compose — wrapper and content scaffolding', () => {
    it('produces the whole holder tree for a sync render', () => {
      const toolRoot = document.createElement('p');

      toolRoot.textContent = 'tool';

      const wrapper = createRenderer({ render: () => toolRoot }).compose();

      // Tailwind's `[&_a]:…` classes serialize with `&` escaped.
      const serializedWrapperClasses = BLOCK_WRAPPER_CLASSES.join(' ').replaceAll('&', '&amp;');

      expect(wrapper.outerHTML).toBe([
        `<div class="${serializedWrapperClasses}"`,
        ' data-blok-element="" data-blok-testid="block-wrapper"',
        ' data-blok-component="header" data-blok-id="block-id">',
        `<div class="${BLOCK_CONTENT_CLASSES.join(' ')}"`,
        ' data-blok-element-content="" data-blok-testid="block-content">',
        '<p>tool</p>',
        '</div></div>',
      ].join(''));
    });

    it('gives the wrapper and the content node their full scaffolding classes', () => {
      const wrapper = createRenderer({ render: () => document.createElement('div') }).compose();
      const contentNode = wrapper.querySelector('[data-blok-element-content]');

      expect([...wrapper.classList]).toEqual([...BLOCK_WRAPPER_CLASSES]);
      expect(contentNode).not.toBeNull();
      expect([...(contentNode?.classList ?? [])]).toEqual([...BLOCK_CONTENT_CLASSES]);
    });

    it('leaves data-blok-component off the wrapper when the tool name is empty', () => {
      const wrapper = createRenderer({
        name: '',
        render: () => document.createElement('div'),
      }).compose();

      expect(attributesOf(wrapper)).toEqual({
        'class': BLOCK_WRAPPER_CLASSES.join(' '),
        'data-blok-element': '',
        'data-blok-testid': 'block-wrapper',
        'data-blok-id': 'block-id',
      });
    });

    it('stamps data-blok-component before an async render resolves', async () => {
      const renderer = createRenderer({
        render: () => Promise.resolve(document.createElement('div')),
      });

      const wrapper = renderer.compose();

      // Read before any await: the async branch adds the attribute only later,
      // so this is the only point where compose()'s own write is visible alone.
      expect(attributesOf(wrapper)).toEqual({
        'class': BLOCK_WRAPPER_CLASSES.join(' '),
        'data-blok-element': '',
        'data-blok-testid': 'block-wrapper',
        'data-blok-component': 'header',
        'data-blok-id': 'block-id',
      });

      await renderer.ready;
    });

    it('writes data-blok-component exactly once when compose already set it', () => {
      const setAttributeSpy = vi.spyOn(Element.prototype, 'setAttribute');

      const wrapper = createRenderer({ render: () => document.createElement('div') }).compose();

      const componentWrites = setAttributeSpy.mock.calls.filter(
        (call) => call[0] === 'data-blok-component'
      );

      expect(componentWrites).toEqual([['data-blok-component', 'header']]);
      expect(wrapper.getAttribute('data-blok-component')).toBe('header');
    });
  });

  describe('addToolDataAttributes — component attribute', () => {
    it('restores data-blok-component when the host strips it before the async render resolves', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const toolRoot = document.createElement('div');
      const renderer = createRenderer({ render: () => Promise.resolve(toolRoot) });

      const wrapper = renderer.compose();

      // Only window in which the guard inside addToolDataAttributes can be
      // false: compose() sets the attribute synchronously, the async branch
      // re-checks it a microtask later.
      wrapper.removeAttribute('data-blok-component');

      await flushTasks();

      expect(wrapper.getAttribute('data-blok-component')).toBe('header');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('adds the placeholder attribute and classes on the async render path', async () => {
      const toolRoot = document.createElement('div');
      const renderer = createRenderer({
        render: () => Promise.resolve(toolRoot),
        config: { placeholder: 'Enter header' },
      });

      const wrapper = renderer.compose();

      await flushTasks();

      expect(attributesOf(toolRoot)).toEqual({
        'class': PLACEHOLDER_CLASSES.join(' '),
        'data-blok-placeholder': 'Enter header',
      });
      expect(wrapper.querySelector('[data-blok-element-content]')?.firstElementChild).toBe(toolRoot);
    });
  });

  describe('addToolDataAttributes — placeholder', () => {
    it('stamps the trimmed placeholder and the complete class list', () => {
      const toolRoot = document.createElement('div');

      createRenderer({
        render: () => toolRoot,
        config: { placeholder: '  Enter header  ' },
      }).compose();

      expect(toolRoot.getAttribute('data-blok-placeholder')).toBe('Enter header');
      expect([...toolRoot.classList]).toEqual(PLACEHOLDER_CLASSES);
    });

    it('treats a whitespace-only placeholder as absent', () => {
      const toolRoot = document.createElement('div');

      createRenderer({
        render: () => toolRoot,
        config: { placeholder: '   ' },
      }).compose();

      expect(attributesOf(toolRoot)).toEqual({});
    });

    it('keeps a placeholder the tool wrote itself when the config has none', () => {
      const toolRoot = document.createElement('div');

      toolRoot.setAttribute('data-blok-placeholder', 'keep me');

      createRenderer({ render: () => toolRoot }).compose();

      expect(attributesOf(toolRoot)).toEqual({ 'data-blok-placeholder': 'keep me' });
    });
  });

  describe('refreshToolRootElement', () => {
    it('keeps the current tool root when the content node has no children', () => {
      const toolRoot = document.createElement('div');
      const renderer = createRenderer({ render: () => toolRoot });

      const wrapper = renderer.compose();

      toolRoot.remove();
      renderer.refreshToolRootElement(wrapper);

      expect(renderer.toolRenderedElement).toBe(toolRoot);
    });
  });

  describe('logging', () => {
    it('logs the rejected render through console.error and still resolves ready', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('Render failed');
      const renderer = createRenderer({ render: () => Promise.reject(failure) });

      renderer.compose();

      await renderer.ready;

      // `_log` appends its own ` %o`, so the produced first argument carries two.
      expect(errorSpy.mock.calls).toEqual([['Tool render promise rejected: %o %o', failure]]);
    });

    it('logs a throwing rendered() through console.warn and still resolves ready', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const renderer = createRenderer({
        render: () => document.createElement('div'),
        rendered: () => {
          throw new Error('boom');
        },
      });

      renderer.compose();

      await flushFrame();
      await renderer.ready;

      expect(warnSpy.mock.calls).toEqual([['header: rendered() threw: boom']]);
    });
  });

  /**
   * Mutants with no observable effect. Each is recorded with the evidence that
   * makes the two programs indistinguishable through the public surface.
   *
   * 1. compose(), `wrapper.hasAttribute('data-blok-component')` → `hasAttribute('')`.
   *    The wrapper is created one line earlier by `$.make('div', styles)` with no
   *    attributes argument, so it can never carry the component attribute at that
   *    point; and jsdom returns false for `hasAttribute('')` (probed: an empty
   *    qualified name matches no attribute). Both readings are false, so the
   *    negated guard is true either way.
   *
   * 2. refreshToolRootElement, `firstChild !== this.toolRenderedElementInternal`
   *    → `true`. The extra branch only fires when firstChild IS the current root,
   *    and the body then assigns that same reference to a plain private field —
   *    there is no setter and no other write, so a self-assignment is inert.
   *
   * 3-5. `this.readyResolver?.()` (async catch, line 187), `resolver?.()` (line
   *    210) and `this.readyResolver?.()` (line 214) → non-optional calls.
   *    `readyResolver` has exactly one write in the whole file (line 56, inside
   *    the Promise executor) and the executor runs synchronously — probed with
   *    `let r = null; new Promise((x) => { r = x; }); typeof r` → 'function'. The
   *    field is private, has no setter, and nothing ever restores it to null, so
   *    the optional call can never short-circuit. Killing these would require
   *    writing the private field from a test, i.e. a state the class cannot enter.
   */
});
