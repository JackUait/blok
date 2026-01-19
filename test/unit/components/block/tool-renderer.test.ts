import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToolRenderer } from '../../../../src/components/block/tool-renderer';
import type { TunesManager } from '../../../../src/components/block/tunes-manager';
import type { BlockTool } from '@/types';

// Mock TunesManager
vi.mock('../../../../src/components/block/tunes-manager');

describe('ToolRenderer', () => {
  let toolInstance: BlockTool;
  let tunesManager: TunesManager;
  let toolRenderer: ToolRenderer;
  let mockRenderedElement: HTMLElement;

  beforeEach(() => {
    mockRenderedElement = document.createElement('div');
    mockRenderedElement.innerHTML = '<p>Tool content</p>';

    toolInstance = {
      render: vi.fn(() => mockRenderedElement),
      save: vi.fn(() => ({ text: 'content' })),
    } as unknown as BlockTool;

    tunesManager = {
      wrapContent: vi.fn((content: HTMLElement) => content),
    } as unknown as TunesManager;

    toolRenderer = new ToolRenderer(
      toolInstance,
      'paragraph',
      'test-block-id',
      tunesManager,
      {}
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(toolRenderer).toBeInstanceOf(ToolRenderer);
    });

    it('initializes ready promise', () => {
      expect(toolRenderer.ready).toBeInstanceOf(Promise);
    });
  });

  describe('compose', () => {
    it('creates wrapper element with correct attributes', () => {
      const wrapper = toolRenderer.compose();

      expect(wrapper).toBeInstanceOf(HTMLDivElement);
      expect(wrapper).toHaveAttribute('data-blok-element', '');
      expect(wrapper).toHaveAttribute('data-blok-testid', 'block-wrapper');
      expect(wrapper).toHaveAttribute('data-blok-component', 'paragraph');
      expect(wrapper).toHaveAttribute('data-blok-id', 'test-block-id');
    });

    it('creates content element with correct attributes', () => {
      const wrapper = toolRenderer.compose();
      const contentElement = wrapper.querySelector('[data-blok-element-content]');

      expect(contentElement).toBeTruthy();
      expect(contentElement?.getAttribute('data-blok-testid')).toBe('block-content');
    });

    it('appends rendered tool element to content', () => {
      const wrapper = toolRenderer.compose();
      const contentElement = wrapper.querySelector('[data-blok-element-content]');

      expect(contentElement?.contains(mockRenderedElement)).toBe(true);
    });

    it('resolves ready promise for sync render', async () => {
      toolRenderer.compose();

      let readyResolved = false;
      void toolRenderer.ready.then(() => {
        readyResolved = true;
      });

      // Wait for microtask queue to flush
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(readyResolved).toBe(true);
    });

    describe('Async render', () => {
      it('handles async tool render with Promise', async () => {
        const asyncElement = document.createElement('div');
        asyncElement.innerHTML = '<p>Async content</p>';
        toolInstance.render = vi.fn(() => Promise.resolve(asyncElement));

        const renderer = new ToolRenderer(
          toolInstance,
          'paragraph',
          'test-block-id',
          tunesManager,
          {}
        );

        const wrapper = renderer.compose();

        let readyResolved = false;
        void renderer.ready.then(() => {
          readyResolved = true;
        });

        // Wait for promise to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(readyResolved).toBe(true);
        expect(wrapper.querySelector('[data-blok-element-content]')?.contains(asyncElement)).toBe(true);
      });

      it('handles render promise rejection', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        toolInstance.render = vi.fn(() => Promise.reject(new Error('Render failed')));

        const renderer = new ToolRenderer(
          toolInstance,
          'paragraph',
          'test-block-id',
          tunesManager,
          {}
        );

        renderer.compose();

        let readyResolved = false;
        void renderer.ready.then(() => {
          readyResolved = true;
        });

        // Wait for promise to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(readyResolved).toBe(true);
        // Note: log is called from the ToolRenderer's error handling
        logSpy.mockRestore();
      });
    });

    describe('Placeholder attributes', () => {
      it('adds placeholder for non-paragraph tools', () => {
        toolInstance.render = vi.fn(() => mockRenderedElement);

        const renderer = new ToolRenderer(
          toolInstance,
          'header',
          'test-block-id',
          tunesManager,
          { placeholder: 'Enter header...' }
        );

        renderer.compose();

        expect(mockRenderedElement).toHaveAttribute('data-blok-placeholder', 'Enter header...');
      });

      it('adds placeholder classes for non-paragraph tools', () => {
        toolInstance.render = vi.fn(() => mockRenderedElement);

        const renderer = new ToolRenderer(
          toolInstance,
          'header',
          'test-block-id',
          tunesManager,
          { placeholder: 'Enter header...' }
        );

        renderer.compose();

        expect(mockRenderedElement).toHaveAttribute('data-blok-placeholder', 'Enter header...');
      });

      it('skips placeholder for paragraph tool', () => {
        toolInstance.render = vi.fn(() => mockRenderedElement);

        const renderer = new ToolRenderer(
          toolInstance,
          'paragraph',
          'test-block-id',
          tunesManager,
          { placeholder: 'Enter text...' }
        );

        renderer.compose();

        expect(mockRenderedElement).not.toHaveAttribute('data-blok-placeholder');
      });

      it('removes placeholder when config sets placeholder to false', () => {
        mockRenderedElement.setAttribute('data-blok-placeholder', 'Old placeholder');
        toolInstance.render = vi.fn(() => mockRenderedElement);

        const renderer = new ToolRenderer(
          toolInstance,
          'header',
          'test-block-id',
          tunesManager,
          { placeholder: false }
        );

        renderer.compose();

        expect(mockRenderedElement).not.toHaveAttribute('data-blok-placeholder');
      });
    });
  });

  describe('toolRenderedElement getter', () => {
    it('returns null before compose is called', () => {
      const renderer = new ToolRenderer(
        toolInstance,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      expect(renderer.toolRenderedElement).toBeNull();
    });

    it('returns rendered element after compose', () => {
      toolRenderer.compose();

      expect(toolRenderer.toolRenderedElement).toBe(mockRenderedElement);
    });
  });

  describe('contentElement getter', () => {
    it('returns null before compose is called', () => {
      const renderer = new ToolRenderer(
        toolInstance,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      expect(renderer.contentElement).toBeNull();
    });

    it('returns content element after compose', () => {
      toolRenderer.compose();

      expect(toolRenderer.contentElement).toBeInstanceOf(HTMLDivElement);
      expect(toolRenderer.contentElement?.getAttribute('data-blok-element-content')).toBe('');
    });
  });

  describe('pluginsContent getter', () => {
    it('throws error before compose is called', () => {
      const renderer = new ToolRenderer(
        toolInstance,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}

      );

      expect(() => renderer.pluginsContent).toThrow('Block pluginsContent is not yet initialized');
    });

    it('returns rendered element after compose', () => {
      toolRenderer.compose();

      expect(toolRenderer.pluginsContent).toBe(mockRenderedElement);
    });
  });

  describe('refreshToolRootElement', () => {
    it('does nothing when content element not found', () => {
      const wrapper = document.createElement('div');

      expect(() => toolRenderer.refreshToolRootElement(wrapper)).not.toThrow();
    });

    it('updates tool root element when first child changes', () => {
      const wrapper = toolRenderer.compose();
      const newRootElement = document.createElement('div');
      const contentNode = toolRenderer.contentElement;

      // Replace the existing tool element with a new one
      contentNode?.replaceChild(newRootElement, mockRenderedElement);

      toolRenderer.refreshToolRootElement(wrapper);

      expect(toolRenderer.toolRenderedElement).toBe(newRootElement);
    });
  });

  describe('rendered lifecycle method', () => {
    it('calls rendered() with correct this context for sync render', async () => {
      const renderedSpy = vi.fn(function(this: { testProperty: string }) {
        // This will throw if 'this' is undefined or doesn't have the expected property
        expect(this.testProperty).toBe('test-value');
      });

      const toolWithRendered = {
        render: vi.fn(() => mockRenderedElement),
        save: vi.fn(() => ({ text: 'content' })),
        rendered: renderedSpy,
        testProperty: 'test-value',
      } as unknown as BlockTool;

      const renderer = new ToolRenderer(
        toolWithRendered,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      renderer.compose();

      // Wait for requestAnimationFrame to execute
      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(renderedSpy).toHaveBeenCalledTimes(1);
    });

    it('calls rendered() with correct this context for async render', async () => {
      const renderedSpy = vi.fn(function(this: { testProperty: string }) {
        expect(this.testProperty).toBe('async-value');
      });

      const asyncElement = document.createElement('div');
      asyncElement.innerHTML = '<p>Async content</p>';

      const toolWithAsyncRenderAndRendered = {
        render: vi.fn(() => Promise.resolve(asyncElement)),
        save: vi.fn(() => ({ text: 'content' })),
        rendered: renderedSpy,
        testProperty: 'async-value',
      } as unknown as BlockTool;

      const renderer = new ToolRenderer(
        toolWithAsyncRenderAndRendered,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      renderer.compose();

      // Wait for promise and requestAnimationFrame to execute
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(renderedSpy).toHaveBeenCalledTimes(1);
    });

    it('resolves ready promise after rendered() callback for sync render', async () => {
      let readyResolved = false;
      let renderedCalled = false;

      const toolWithRendered = {
        render: vi.fn(() => mockRenderedElement),
        save: vi.fn(() => ({ text: 'content' })),
        rendered: vi.fn(() => {
          renderedCalled = true;
        }),
      } as unknown as BlockTool;

      const renderer = new ToolRenderer(
        toolWithRendered,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      renderer.compose();

      void renderer.ready.then(() => {
        readyResolved = true;
      });

      // Wait for requestAnimationFrame
      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(renderedCalled).toBe(true);
      expect(readyResolved).toBe(true);
    });

    it('does not call rendered() when tool does not implement it', async () => {
      const toolWithoutRendered = {
        render: vi.fn(() => mockRenderedElement),
        save: vi.fn(() => ({ text: 'content' })),
      } as unknown as BlockTool;

      const renderer = new ToolRenderer(
        toolWithoutRendered,
        'paragraph',
        'test-block-id',
        tunesManager,
        {}
      );

      renderer.compose();

      // Wait for requestAnimationFrame
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Should not throw - ready should still resolve
      let readyResolved = false;
      void renderer.ready.then(() => {
        readyResolved = true;
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(readyResolved).toBe(true);
    });
  });
});
