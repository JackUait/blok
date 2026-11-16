import type { BlockTool as IBlockTool , ToolConfig } from '../../../types';
import { DATA_ATTR, TEST_ID } from '../constants';
import { Dom as $ } from '../dom';
import { log } from '../utils';

import { StyleManager } from './style-manager';
import type { TunesManager } from './tunes-manager';

/**
 * Type for tool config that may contain a placeholder property
 */
interface ToolConfigWithPlaceholder {
  placeholder?: string | false;
}

/** Wrapper and content element every block copies. Built once: parsing their classes per block is slow. */
const scaffold: { wrapper?: HTMLDivElement; content?: HTMLElement } = {};

const getScaffold = (): { wrapper: HTMLDivElement; content: HTMLElement } => {
  if (scaffold.wrapper === undefined || scaffold.content === undefined) {
    scaffold.wrapper = $.make('div', StyleManager.wrapperStyles) as HTMLDivElement;
    scaffold.wrapper.setAttribute(DATA_ATTR.element, '');
    scaffold.wrapper.setAttribute(DATA_ATTR.testid, TEST_ID.blockWrapper);

    scaffold.content = $.make('div', StyleManager.contentStyles);
    scaffold.content.setAttribute(DATA_ATTR.elementContent, '');
    scaffold.content.setAttribute('data-blok-testid', 'block-content');
  }

  return { wrapper: scaffold.wrapper, content: scaffold.content };
};

/**
 * Handles tool element composition, rendering, and DOM lifecycle.
 * Manages the wrapper, content element, and tool rendered element.
 */
export class ToolRenderer {
  /**
   * Reference to the tool's rendered element (what the tool's render() returns)
   */
  private toolRenderedElementInternal: HTMLElement | null = null;

  /**
   * Reference to the content wrapper element (contains the tool element)
   */
  private contentElementInternal: HTMLElement | null = null;

  /**
   * Promise that resolves when the block is ready (rendered)
   */
  public readonly ready: Promise<void>;

  /**
   * Resolver for ready promise
   */
  private readyResolver: (() => void) | null = null;

  /**
   * Set once the block is destroyed (removed or replaced)
   */
  private destroyed = false;

  public deferred = false;

  public pending = false;

  private activatedDeferred = false;

  private renderedFromStore = false;

  /**
   * @param toolInstance - The tool class instance
   * @param name - Block tool name
   * @param id - Block id
   * @param tunesManager - Tunes manager for wrapping content
   * @param config - Tool configuration
   */
  constructor(
    private readonly toolInstance: IBlockTool,
    private readonly name: string,
    private readonly id: string,
    private readonly tunesManager: TunesManager,
    private readonly config: ToolConfig<ToolConfigWithPlaceholder>,
    private readonly renderedBarrier?: Promise<void>,
    private readonly runDeferredLifecycle: (callback: () => void) => void = (callback) => callback()
  ) {
    this.ready = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
  }

  /**
   * Get the tool's rendered element
   */
  public get toolRenderedElement(): HTMLElement | null {
    return this.toolRenderedElementInternal;
  }

  /**
   * Update the tool's rendered element reference.
   * Called when the tool replaces its root element (e.g., list type conversion UL → OL).
   * @param element - The new tool root element
   */
  public set toolRenderedElement(element: HTMLElement | null) {
    this.toolRenderedElementInternal = element;
  }

  /**
   * Get the content wrapper element
   */
  public get contentElement(): HTMLElement | null {
    return this.contentElementInternal;
  }

  /**
   * Get the plugins content (tool rendered element)
   * Throws if not yet initialized
   */
  public get pluginsContent(): HTMLElement {
    if (this.toolRenderedElementInternal === null) {
      throw new Error('Block pluginsContent is not yet initialized');
    }

    return this.toolRenderedElementInternal;
  }

  /**
   * Create the block wrapper and content elements, render the tool, and assemble the DOM.
   * @returns The wrapper div element
   */
  public compose(deferRender = false): HTMLDivElement {
    const template = getScaffold();
    const wrapper = template.wrapper.cloneNode(false) as HTMLDivElement;
    const contentNode = template.content.cloneNode(false) as HTMLElement;

    this.contentElementInternal = contentNode;

    if (this.name && !wrapper.hasAttribute('data-blok-component')) {
      wrapper.setAttribute('data-blok-component', this.name);
    }

    // Export id to the DOM tree for standalone modules development
    wrapper.setAttribute('data-blok-id', this.id);

    if (deferRender) {
      this.deferred = true;
      wrapper.setAttribute('data-blok-deferred-render', '');
      // Keep child holders in the block tree while its tool has no DOM. The
      // real container's rendered() hook adopts them when the row is opened.
      const placeholder = document.createElement('div');

      placeholder.setAttribute(DATA_ATTR.nestedBlocks, '');
      this.toolRenderedElementInternal = placeholder;
      contentNode.appendChild(placeholder);
    } else {
      this.renderInto(contentNode, wrapper);
    }

    // Wrap content with tunes
    const wrappedContentNode = this.tunesManager.wrapContent(contentNode);
    wrapper.appendChild(wrappedContentNode);

    return wrapper;
  }

  /** Materialise into the stable holder; the tool's children remain registered. */
  public renderDeferred(wrapper: HTMLDivElement): void {
    const content = this.contentElementInternal;

    if (!this.deferred || this.destroyed || content === null) return;
    const placeholder = this.toolRenderedElementInternal;

    this.deferred = false;
    this.activatedDeferred = true;
    wrapper.removeAttribute('data-blok-deferred-render');
    content.replaceChildren();
    try {
      this.renderInto(content, wrapper);
    } catch (error) {
      this.deferred = true;
      this.activatedDeferred = false;
      this.toolRenderedElementInternal = placeholder;
      wrapper.setAttribute('data-blok-deferred-render', '');
      content.replaceChildren(...(placeholder === null ? [] : [placeholder]));
      throw error;
    }
  }

  public markRenderedFromStore(): void {
    if (!this.deferred && !this.pending && (this.renderedBarrier !== undefined || this.activatedDeferred)) this.renderedFromStore = true;
  }

  private renderInto(content: HTMLElement, wrapper: HTMLDivElement): void {
    const pluginsContent = this.toolInstance.render();

    if (pluginsContent instanceof Promise) {
      this.pending = true;
      this.handleAsyncRender(pluginsContent, content, wrapper);
    } else this.handleSyncRender(pluginsContent, content, wrapper);
  }

  /**
   * Stop a queued rendered() from running. A replacement keeps the block id,
   * so a dead container's rendered() would pull the new block's children
   * into its own detached slot.
   */
  public destroy(): void {
    this.destroyed = true;
    this.readyResolver?.();
  }

  /**
   * Refreshes the reference to the tool's root element by inspecting the block content.
   * Call this after operations (like onPaste) that might cause the tool to replace its element.
   * @param holder - The block holder element
   */
  public refreshToolRootElement(holder: HTMLDivElement): void {
    const contentNode = holder.querySelector(`[${DATA_ATTR.elementContent}]`);

    if (!contentNode) {
      return;
    }

    const firstChild = contentNode.firstElementChild as HTMLElement | null;

    if (firstChild && firstChild !== this.toolRenderedElementInternal) {
      this.toolRenderedElementInternal = firstChild;
    }
  }

  /**
   * Handle synchronous tool render
   */
  private handleSyncRender(
    pluginsContent: HTMLElement,
    contentNode: HTMLElement,
    wrapper: HTMLDivElement
  ): void {
    this.toolRenderedElementInternal = pluginsContent;
    this.addToolDataAttributes(pluginsContent, wrapper);
    contentNode.appendChild(pluginsContent);

    this.invokeRenderedLifecycle();
  }

  /**
   * Handle asynchronous tool render
   */
  private handleAsyncRender(
    pluginsContent: Promise<HTMLElement>,
    contentNode: HTMLElement,
    wrapper: HTMLDivElement
  ): void {
    pluginsContent
      .then((resolvedElement) => {
        /** Awaiters of `ready` must still be released. */
        if (this.destroyed) {
          this.readyResolver?.();

          return;
        }

        this.pending = false;
        this.toolRenderedElementInternal = resolvedElement;
        this.addToolDataAttributes(resolvedElement, wrapper);
        contentNode.appendChild(resolvedElement);

        this.invokeRenderedLifecycle();
      })
      .catch((error) => {
        this.pending = false;
        if (this.activatedDeferred) {
          this.deferred = true;
          wrapper.setAttribute('data-blok-deferred-render', '');
          const placeholder = this.toolRenderedElementInternal;

          if (placeholder !== null) contentNode.replaceChildren(placeholder);
        }
        log(`Tool render promise rejected: %o`, 'error', error);
        this.readyResolver?.();
      });
  }

  /**
   * Call the tool's rendered lifecycle method if it exists.
   * Defers to next frame to ensure all blocks are registered.
   * Always resolves readyResolver, even if rendered() throws.
   */
  private invokeRenderedLifecycle(): void {
    const rendered = this.toolInstance.rendered;

    if (typeof rendered === 'function') {
      const resolver = this.readyResolver;
      const toolInstance = this.toolInstance;
      const name = this.name;

      const schedule = (): void => {
        requestAnimationFrame(() => {
          try {
            if (this.destroyed || this.renderedFromStore) {
              return;
            }
            if (this.activatedDeferred) this.runDeferredLifecycle(() => rendered.call(toolInstance));
            else rendered.call(toolInstance);
          } catch (e) {
            log(`${name}: rendered() threw: ${e instanceof Error ? e.message : String(e)}`, 'warn');
          } finally {
            resolver?.();
          }
        });
      };

      if (this.renderedBarrier === undefined) schedule();
      else void this.renderedBarrier.then(schedule);
    } else if (this.renderedBarrier === undefined) {
      this.readyResolver?.();
    } else {
      void this.renderedBarrier.then(() => this.readyResolver?.());
    }
  }

  /**
   * Add data attributes to tool-rendered element based on tool name
   */
  private addToolDataAttributes(element: HTMLElement, blockWrapper: HTMLDivElement): void {
    // Add data-blok-component attribute to identify the tool type
    if (this.name && !blockWrapper.hasAttribute('data-blok-component')) {
      blockWrapper.setAttribute('data-blok-component', this.name);
    }

    const placeholderAttribute = 'data-blok-placeholder';
    const placeholder = this.config.placeholder;
    const placeholderText = typeof placeholder === 'string' ? placeholder.trim() : '';

    // Paragraph tool handles its own placeholder via data-blok-placeholder-active attribute
    // so we skip the block-level placeholder for it.
    if (this.name === 'paragraph') {
      return;
    }

    // Placeholder styling classes using Tailwind arbitrary variants.
    // The inline-block/w-0/whitespace-nowrap trio keeps the pseudo out of the
    // inline advance so it cannot push the caret — see the Placeholder
    // Layout-Inert Law in components/utils/placeholder.ts.
    const placeholderClasses = [
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

    if (placeholderText.length > 0) {
      element.setAttribute(placeholderAttribute, placeholderText);
      element.classList.add(...placeholderClasses);
      return;
    }

    if (placeholder === false && element.hasAttribute(placeholderAttribute)) {
      element.removeAttribute(placeholderAttribute);
    }
  }
}
