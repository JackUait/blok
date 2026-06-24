import { forwardRef, useImperativeHandle, type DependencyList } from 'react';
import { useBlok } from './useBlok';
import { BlokContent } from './BlokContent';
import type { Blok } from '@/types';
import type { UseBlokConfig } from './types';

/**
 * Props for the all-in-one BlokEditor component.
 * Accepts every useBlok config prop, plus container `className` and an optional
 * `deps` list. When any value in `deps` changes, the editor is destroyed and
 * recreated (use this when `tools` or other structural config changes).
 */
export interface BlokEditorProps extends UseBlokConfig {
  /** When any value changes, the editor is destroyed and recreated. */
  deps?: DependencyList;
  /** Class name applied to the editor container element. */
  className?: string;
  /** Test id forwarded to the editor container element (via data-testid). */
  'data-testid'?: string;
}

/**
 * The recommended way to embed Blok in React. Internally wires `useBlok` and
 * `BlokContent`, and forwards a ref to the live `Blok` instance.
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} tools={tools} data={data} theme={theme} onChange={fn} />;
 * // ref.current?.save() once ready
 * ```
 */
export const BlokEditor = forwardRef<Blok | null, BlokEditorProps>(
  function BlokEditor({ deps, className, 'data-testid': dataTestId, ...config }, ref) {
    const editor = useBlok(config, deps);

    useImperativeHandle<Blok | null, Blok | null>(ref, () => editor, [editor]);

    return <BlokContent editor={editor} className={className} data-testid={dataTestId} />;
  }
);
