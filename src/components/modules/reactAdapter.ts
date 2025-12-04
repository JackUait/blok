import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Module from '../__module';
import { EditorProvider } from '../react/EditorProvider';
import type { BlokModules } from '../../types-internal/blok-modules';

/**
 * Nodes managed by the ReactAdapter module
 */
interface ReactAdapterNodes {
  /**
   * Container element for the React root
   */
  reactRoot: HTMLElement;
}

/**
 * ReactAdapter Module
 *
 * This module serves as the bridge between vanilla Blok modules and React components.
 * It manages the React root lifecycle and provides methods for rendering React components
 * within the editor.
 *
 * Key responsibilities:
 * - Create and manage React root alongside existing DOM structure
 * - Provide EditorProvider context to all React components
 * - Handle React root cleanup on editor destruction
 * - Expose methods for vanilla modules to trigger React re-renders
 */
export default class ReactAdapter extends Module<ReactAdapterNodes> {
  /**
   * React 18 root instance
   */
  private root: Root | null = null;

  /**
   * Current React component tree to render
   */
  private currentComponent: React.ReactNode = null;

  /**
   * Flag to track if React root is mounted
   */
  private isMounted = false;

  /**
   * Prepare the ReactAdapter module
   * Creates the React root container but doesn't render anything yet
   */
  public async prepare(): Promise<void> {
    this.createReactContainer();
  }

  /**
   * Render a React component tree within the editor context
   * The component will be wrapped with EditorProvider automatically
   *
   * @param component - React component or element to render
   */
  public render(component: React.ReactNode): void {
    if (!this.root) {
      this.initializeRoot();
    }

    this.currentComponent = component;
    this.performRender();
  }

  /**
   * Force a re-render of the current component tree
   * Useful when vanilla module state changes and React needs to update
   */
  public forceUpdate(): void {
    if (this.isMounted && this.currentComponent) {
      this.performRender();
    }
  }

  /**
   * Unmount React components and cleanup
   */
  public destroy(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }

    if (this.nodes.reactRoot?.parentNode) {
      this.nodes.reactRoot.remove();
    }

    this.isMounted = false;
    this.currentComponent = null;
  }

  /**
   * Get the React root container element
   */
  public getContainer(): HTMLElement | null {
    return this.nodes.reactRoot ?? null;
  }

  /**
   * Check if React root is currently mounted
   */
  public get mounted(): boolean {
    return this.isMounted;
  }

  /**
   * Get all Blok modules for context provider
   * Includes self (ReactAdapter) in the modules object
   */
  private getModulesWithSelf(): BlokModules {
    return {
      ...this.Blok,
      ReactAdapter: this,
    } as BlokModules;
  }

  /**
   * Create the container element for React root
   * Positioned as a sibling to the main editor wrapper
   */
  private createReactContainer(): void {
    const container = document.createElement('div');

    container.setAttribute('data-blok-react-root', '');
    container.setAttribute('data-blok-testid', 'react-root');

    // Style to make it overlay correctly without affecting layout
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 2;
    `;

    this.nodes.reactRoot = container;
  }

  /**
   * Append the React container to the editor holder
   * Called when we need to actually mount React content
   */
  private appendContainer(): void {
    const { UI } = this.Blok;

    if (!UI?.nodes?.wrapper) {
      console.warn('[ReactAdapter] UI module not ready, cannot append React container');

      return;
    }

    // Append as sibling to wrapper, inside holder
    const holder = UI.nodes.holder;

    if (!holder || holder.contains(this.nodes.reactRoot)) {
      return;
    }

    // Make holder position relative if not already
    const holderStyle = window.getComputedStyle(holder);

    if (holderStyle.position === 'static') {
      holder.style.position = 'relative';
    }

    holder.appendChild(this.nodes.reactRoot);
  }

  /**
   * Initialize the React 18 root
   */
  private initializeRoot(): void {
    if (!this.nodes.reactRoot) {
      this.createReactContainer();
    }

    this.appendContainer();
    this.root = createRoot(this.nodes.reactRoot);
    this.isMounted = true;
  }

  /**
   * Perform the actual React render with EditorProvider wrapper
   */
  private performRender(): void {
    if (!this.root) {
      return;
    }

    const wrappedComponent = React.createElement(
      EditorProvider,
      {
        modules: this.getModulesWithSelf(),
        config: this.config,
        eventsDispatcher: this.eventsDispatcher,
      },
      this.currentComponent
    );

    this.root.render(wrappedComponent);
  }
}
