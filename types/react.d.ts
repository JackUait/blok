import type { BlokConfig } from './index';
import type { Blok } from './index';

/**
 * Configuration for the useBlok hook.
 * Accepts all BlokConfig properties except `holder`, which is managed by BlokContent.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`
 * - `autofocus` — calls `editor.focus()` when changed to true
 *
 * All other config is consumed once at editor creation.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {}

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
export declare const BlokContent: React.FC<BlokContentProps>;
