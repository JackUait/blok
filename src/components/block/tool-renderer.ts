import type { BlockTool as IBlockTool , ToolConfig } from '../../../types';
import { DATA_ATTR } from '../constants';
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
    private readonly config: ToolConfig<ToolConfigWithPlaceholder>
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
  public compose(): HTMLDivElement {
    const wrapper = $.make('div', this.getWrapperStyles()) as HTMLDivElement;
    const contentNode = $.make('div', this.getContentStyles());

    this.contentElementInternal = contentNode;

    // Set data attributes for block element and content
    wrapper.setAttribute(DATA_ATTR.element, '');
    contentNode.setAttribute(DATA_ATTR.elementContent, '');
    contentNode.setAttribute('data-blok-testid', 'block-content');

    wrapper.setAttribute('data-blok-testid', 'block-wrapper');

    if (this.name && !wrapper.hasAttribute('data-blok-component')) {
      wrapper.setAttribute('data-blok-component', this.name);
    }

    // Export id to the DOM tree for standalone modules development
    wrapper.setAttribute('data-blok-id', this.id);

    // Render the tool (handles both sync and async)
    const pluginsContent = this.toolInstance.render();

    if (pluginsContent instanceof Promise) {
      this.handleAsyncRender(pluginsContent, contentNode, wrapper);
    } else {
      this.handleSyncRender(pluginsContent, contentNode, wrapper);
    }

    // Wrap content with tunes
    const wrappedContentNode = this.tunesManager.wrapContent(contentNode);
    wrapper.appendChild(wrappedContentNode);

    return wrapper;
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
    this.readyResolver?.();
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
        this.toolRenderedElementInternal = resolvedElement;
        this.addToolDataAttributes(resolvedElement, wrapper);
        contentNode.appendChild(resolvedElement);
        this.readyResolver?.();
      })
      .catch((error) => {
        log(`Tool render promise rejected: %o`, 'error', error);
        this.readyResolver?.();
      });
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

    // Placeholder styling classes using Tailwind arbitrary variants
    const placeholderClasses = [
      'empty:before:pointer-events-none',
      'empty:before:text-gray-text',
      'empty:before:cursor-text',
      'empty:before:content-[attr(data-blok-placeholder)]',
      '[&[data-blok-empty=true]]:before:pointer-events-none',
      '[&[data-blok-empty=true]]:before:text-gray-text',
      '[&[data-blok-empty=true]]:before:cursor-text',
      '[&[data-blok-empty=true]]:before:content-[attr(data-blok-placeholder)]',
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

  /**
   * Get wrapper element styles
   */
  private getWrapperStyles(): string {
    return StyleManager.wrapperStyles;
  }

  /**
   * Get content element styles
   */
  private getContentStyles(): string {
    return StyleManager.contentStyles;
  }
}
