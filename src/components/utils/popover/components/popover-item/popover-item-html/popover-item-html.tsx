import React, { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PopoverItem } from '../popover-item';
import type { PopoverItemHtmlParams, PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';
import Dom from '../../../../../dom';
import {
  PopoverItemHtmlComponent,
  type PopoverItemHtmlComponentHandle
} from './PopoverItemHtmlComponent';

/**
 * Represents popover item with custom html content
 */
export class PopoverItemHtml extends PopoverItem {
  /**
   * Item html elements
   */
  private nodes: { container: HTMLElement | null; root: HTMLElement | null } = { container: null, root: null };

  /**
   * React 18 root instance for persistent rendering
   */
  private reactRoot: Root | null = null;

  /**
   * Ref to the imperative handle exposed by the React component
   */
  private componentRef = createRef<PopoverItemHtmlComponentHandle>();

  /**
   * Whether this item is in an inline popover context
   */
  private readonly isInline: boolean;

  /**
   * Stored params for accessing custom element
   */
  private readonly itemParams: PopoverItemHtmlParams;

  /**
   * Constructs the instance
   * @param params – instance parameters
   * @param renderParams – popover item render params.
   * The parameters that are not set by user via popover api but rather depend on technical implementation
   */
  constructor(params: PopoverItemHtmlParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Html]) {
    super(params);

    this.itemParams = params;
    this.isInline = renderParams?.isInline ?? false;

    const { container, renderedElement } = this.createRootElement(params, renderParams);

    this.nodes.container = container;
    this.nodes.root = renderedElement;
  }

  /**
   * Returns popover item root element
   */
  public getElement(): HTMLElement {
    return this.nodes.root as HTMLElement;
  }

  /**
   * Returns element that should be mounted into DOM to keep React root attached
   */
  public override getMountElement(): HTMLElement | null {
    return this.nodes.container ?? this.nodes.root;
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public toggleHidden(isHidden: boolean): void {
    this.componentRef.current?.setHidden(isHidden);
  }

  /**
   * Returns list of buttons and inputs inside custom content
   */
  public getControls(): HTMLElement[] {
    if (!this.nodes.root) {
      return [];
    }

    const controls = this.nodes.root.querySelectorAll<HTMLElement>(
      `button, ${Dom.allInputsSelector}`
    );

    return Array.from(controls);
  }

  /**
   * Cleanup method to unmount React root and prevent memory leaks
   */
  public override destroy(): void {
    super.destroy();

    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch {
        // Ignore errors if DOM is already cleaned up by parent popover
      }
      this.reactRoot = null;
    }
  }

  /**
   * Creates the root container element and initializes React rendering
   * @param params - item params
   * @param renderParams - render configuration
   */
  private createRootElement(
    params: PopoverItemHtmlParams,
    renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Html]
  ): { container: HTMLElement; renderedElement: HTMLElement } {
    const container = document.createElement('div');

    container.style.display = 'contents';

    this.reactRoot = createRoot(container);

    flushSync(() => {
      this.reactRoot?.render(
        <PopoverItemHtmlComponent
          ref={this.componentRef}
          element={params.element}
          name={params.name}
          isInline={this.isInline}
        />
      );
    });

    const renderedElement = (container.firstElementChild as HTMLElement) ?? container;

    // Add hint if configured
    if (params.hint !== undefined && renderParams?.hint?.enabled !== false) {
      this.addHint(renderedElement, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }

    return { container, renderedElement };
  }
}
