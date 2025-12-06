import React, { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PopoverItem } from '../popover-item';
import type { PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';
import {
  PopoverItemSeparatorComponent,
  type PopoverItemSeparatorComponentHandle
} from './PopoverItemSeparatorComponent';

/**
 * Represents popover separator node
 */
export class PopoverItemSeparator extends PopoverItem {
 /**
  * Html elements
  */
  private nodes: { container: HTMLElement | null; root: HTMLElement | null } = { container: null, root: null };

  /**
   * React 18 root instance for persistent rendering
   */
  private reactRoot: Root | null = null;

  /**
   * Ref to the imperative handle exposed by the React component
   */
  private componentRef = createRef<PopoverItemSeparatorComponentHandle>();

  /**
   * Whether this separator is in an inline popover context
   */
  private readonly isInline: boolean;

  /**
   * Whether this separator is in a nested inline popover context
   */
  private readonly isNestedInline: boolean;

  /**
   * Constructs the instance
   * @param renderParams - optional render params for styling context
   */
  constructor(renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Separator]) {
    super();

    this.isInline = renderParams?.isInline ?? false;
    this.isNestedInline = renderParams?.isNestedInline ?? false;

    const { container, renderedElement } = this.createRootElement();

    this.nodes.container = container;
    this.nodes.root = renderedElement;
  }

  /**
   * Returns popover separator root element
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
   */
  private createRootElement(): { container: HTMLElement; renderedElement: HTMLElement } {
    const container = document.createElement('div');

    container.style.display = 'contents';

    this.reactRoot = createRoot(container);

    flushSync(() => {
      this.reactRoot?.render(
        <PopoverItemSeparatorComponent
          ref={this.componentRef}
          isInline={this.isInline}
          isNestedInline={this.isNestedInline}
        />
      );
    });

    const renderedElement = container.firstElementChild as HTMLElement;

    return { container, renderedElement: renderedElement ?? container };
  }
}
