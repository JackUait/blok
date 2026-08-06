import {BaseTool, BaseToolConstructable} from './tool';
import {API, ToolConfig} from '../index';
import { MenuConfig } from './menu-config';
/**
 * Base structure for the Inline Toolbar Tool
 */
export interface InlineTool extends BaseTool<MenuConfig> {
  /**
   * Shortcut for Tool
   * @type {string}
   */
  shortcut?: string;

  /**
   * Teardown hook. Inline tool instances are constructed fresh on every
   * toolbar open (and for shortcut probes); the toolbar calls destroy() on
   * every instance it created once that instance is no longer needed —
   * on toolbar close, on editor destroy, and right after throwaway probe
   * instances served their purpose. Use it to release anything render()
   * allocated (event listeners, mounted UI such as React roots, timers).
   * Must be safe to call multiple times.
   */
  destroy?(): void;
}


/**
 * Describe constructor parameters
 */
export interface InlineToolConstructorOptions {
  api: API;
  config?: ToolConfig;
}

export interface InlineToolConstructable extends BaseToolConstructable {
  /**
   * Constructor
   *
   * @param {InlineToolConstructorOptions} config - constructor parameters
   */
  new(config: InlineToolConstructorOptions): InlineTool;

  /**
   * Allows inline tool to be available in read-only mode
   * Can be used, for example, by comments tool
   */
  isReadOnlySupported?: boolean;

  /**
   * When true, the tool's keyboard shortcut opens its menu even at a collapsed
   * caret (nothing selected) — for tools that insert at the caret (e.g.
   * Equation) rather than wrap an existing selection (Link, Marker).
   */
  allowCaretShortcut?: boolean;

  /**
   * When true, the tool's keyboard shortcut defers to the browser's native
   * handling at a collapsed caret instead of being intercepted — for format
   * tools with a native browser equivalent (Bold, Italic), so the browser
   * applies its pending inline-format to the next typed characters (the only
   * race-free, cross-engine "toggle then type" behaviour).
   */
  nativeCaretShortcut?: boolean;

  /**
   * Rebuild this mark's DERIVED DOM inside a freshly rendered block.
   *
   * Some marks display something that is generated from a source they persist
   * on an attribute — an equation renders KaTeX from its `data-latex`, and only
   * the source survives sanitization. Blok calls `hydrate` with the block's
   * rendered tool element once the block is in the DOM, on every path that
   * creates one (initial render, insert, paste, undo), so the mark's display is
   * rebuilt instead of showing whatever text the last save left behind.
   *
   * The hook owns the mutation contract for what it writes: mark the elements
   * it rebuilds `data-blok-mutation-free="true"` so regenerating them does not
   * register as a user edit. Errors are caught and logged — a failing hydrate
   * must never break a block's render.
   *
   * @param root - the block's rendered tool element
   */
  hydrate?(root: HTMLElement): void | Promise<void>;
}
