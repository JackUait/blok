import { forwardRef, useImperativeHandle, useEffect, useRef, type DependencyList } from 'react';
import { useBlok } from './useBlok';
import { BlokContent } from './BlokContent';
import type { Blok } from '@/types';
import type { UseBlokConfig } from './types';

/**
 * Props for the all-in-one BlokEditor component.
 * Accepts every useBlok config prop (except `onReady`, re-typed below to receive
 * the ready instance), plus container `className`/`data-testid` and an optional
 * `deps` list. When any value in `deps` changes, the editor is destroyed and
 * recreated (use this when `tools` or other structural config changes).
 *
 * `data` is uncontrolled (seed-only): it sets the INITIAL content. After mount the
 * editor owns the document — passing a new `data` reference does NOT reload it.
 * Read content via `onChange` or the ref (`ref.current.save()`); replace it
 * imperatively via `ref.current.render(newData)`.
 */
export interface BlokEditorProps extends Omit<UseBlokConfig, 'onReady'> {
  /** When any value changes, the editor is destroyed and recreated. */
  deps?: DependencyList;
  /** Class name applied to the editor container element. */
  className?: string;
  /** Test id forwarded to the editor container element (via data-testid). */
  'data-testid'?: string;
  /**
   * Called once the editor is ready, with the live Blok instance. Fires after the
   * forwarded ref is committed, so `ref.current` is also populated at this point.
   */
  onReady?: (editor: Blok) => void;
}

/**
 * The recommended way to embed Blok in React. Internally wires `useBlok` and
 * `BlokContent`, and forwards a ref to the live `Blok` instance.
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} tools={tools} data={data} theme={theme} onReady={(e) => e.focus()} />;
 * ```
 */
export const BlokEditor = forwardRef<Blok | null, BlokEditorProps>(
  function BlokEditor({ deps, className, onReady, 'data-testid': dataTestId, ...config }, ref) {
    const editor = useBlok(config, deps);

    useImperativeHandle<Blok | null, Blok | null>(ref, () => editor, [editor]);

    // Own onReady here instead of forwarding it to the core config: the core
    // onReady fires before useImperativeHandle commits the ref. This passive
    // effect runs AFTER the commit, so both the instance argument and ref.current
    // are reliably populated.
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    useEffect(() => {
      if (editor !== null) {
        onReadyRef.current?.(editor);
      }
    }, [editor]);

    return <BlokContent editor={editor} className={className} data-testid={dataTestId} />;
  }
);
