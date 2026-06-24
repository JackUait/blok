import type { BlokConfig } from './index';
import type { Blok, EditorWidth } from './index';
import type React from 'react';

/**
 * Configuration for the useBlok hook.
 * Accepts all BlokConfig properties except `holder`, plus a React-only `width` prop.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`
 * - `autofocus` — calls `editor.focus()` when changed to true
 * - `theme` — calls `editor.theme.set(value)`
 * - `width` — calls `editor.width.set(value)`
 *
 * All other config is consumed once at editor creation.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {
  /** Editor content width mode. Synced reactively after mount. */
  width?: EditorWidth;
}

/**
 * Props for the BlokContent component.
 * Renders a `<div>` that becomes the Blok editor's DOM mount point.
 * Passes through all standard HTML div attributes.
 */
export interface BlokContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The Blok editor instance from useBlok. Null during SSR or before initialization. */
  editor: Blok | null;
}

/**
 * React hook that creates and manages a Blok editor instance.
 *
 * @param config - Editor configuration (all BlokConfig props except `holder`)
 * @param deps - Optional dependency array. When any dep changes, the editor is destroyed and recreated.
 * @returns The Blok editor instance, or null during SSR / before initialization.
 *
 * @example
 * ```tsx
 * const editor = useBlok({
 *   tools: defaultTools,
 *   data: savedData,
 *   readOnly: false,
 *   onChange: (api, event) => console.log(event),
 * });
 * ```
 */
export function useBlok(
  config: UseBlokConfig,
  deps?: React.DependencyList
): Blok | null;

/**
 * Component that provides the DOM mount point for a Blok editor.
 * Renders a `<div>` and adopts the editor's DOM tree into it.
 *
 * @example
 * ```tsx
 * <BlokContent editor={editor} className="my-editor" />
 * ```
 */
export declare const BlokContent: React.ForwardRefExoticComponent<BlokContentProps & React.RefAttributes<HTMLDivElement>>;

/**
 * Props for the BlokEditor component — all useBlok config plus container
 * `className` and an optional `deps` list that forces recreation when changed.
 */
export interface BlokEditorProps extends UseBlokConfig {
  /** When any value changes, the editor is destroyed and recreated. */
  deps?: React.DependencyList;
  /** Class name applied to the editor container element. */
  className?: string;
}

/**
 * The recommended all-in-one React component. Wires useBlok + BlokContent and
 * forwards a ref to the live Blok instance (null before the editor is ready).
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} tools={tools} data={data} theme="dark" />;
 * ```
 */
export declare const BlokEditor: React.ForwardRefExoticComponent<
  BlokEditorProps & React.RefAttributes<Blok | null>
>;
