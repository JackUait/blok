import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  type DependencyList,
  type HTMLAttributes,
} from 'react';
import { useBlok } from './useBlok';
import { BlokContent } from './BlokContent';
import { USE_BLOK_CONFIG_KEYS } from './config-keys';
import type { Blok } from '@/types';
import type { UseBlokConfig } from './types';

/**
 * Props for the all-in-one BlokEditor component.
 * Accepts every useBlok config prop (except `onReady`, re-typed below to receive
 * the ready instance) AND every standard HTML div attribute, which is forwarded
 * to the editor container element (mirrors `BlokContent`). `style` and `onChange`
 * keep their editor-config meaning (they collide with div attributes of the same
 * name), so the container is styled via `className` rather than an inline `style`.
 *
 * `data` is uncontrolled (seed-only): it sets the INITIAL content. After mount the
 * editor owns the document — passing a new `data` reference does NOT reload it.
 * Read content via `onChange` or the ref (`ref.current.save()`); replace it
 * imperatively via `ref.current.render(newData)`.
 */
export interface BlokEditorProps
  extends Omit<UseBlokConfig, 'onReady'>,
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'onChange'> {
  /** When any value changes, the editor is destroyed and recreated. */
  deps?: DependencyList;
  /** Test id forwarded to the editor container element (via data-testid). */
  'data-testid'?: string;
  /**
   * Called once the editor is ready, with the live Blok instance. Fires after the
   * forwarded ref is committed, so `ref.current` is also populated at this point.
   */
  onReady?: (editor: Blok) => void;
}

/** Fast membership test for partitioning props into editor config vs. div attributes. */
const CONFIG_KEY_SET = new Set<string>(USE_BLOK_CONFIG_KEYS);

/**
 * The recommended way to embed Blok in React. Internally wires `useBlok` and
 * `BlokContent`, and forwards a ref to the live `Blok` instance.
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} id="editor" tools={tools} data={data} theme={theme} onReady={(e) => e.focus()} />;
 * ```
 */
export const BlokEditor = forwardRef<Blok | null, BlokEditorProps>(
  function BlokEditor({ deps, onReady, ...rest }, ref) {
    const config: Record<string, unknown> = {};
    const divProps: Record<string, unknown> = {};

    for (const key of Object.keys(rest)) {
      const value = (rest as Record<string, unknown>)[key];

      if (CONFIG_KEY_SET.has(key)) {
        config[key] = value;
      } else {
        divProps[key] = value;
      }
    }

    const editor = useBlok(config as UseBlokConfig, deps);

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

    return <BlokContent editor={editor} {...(divProps as HTMLAttributes<HTMLDivElement>)} />;
  }
);
