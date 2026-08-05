import { useRef, useMemo, type RefCallback } from 'react';
import { EMPTY_OUTPUT_DATA } from '@bloklabs/core/adapters';
import { getContentBaseline } from './content-baseline-map';
import type { Blok, OutputData, LooseOutputData } from '@/types';

/**
 * A typed, null-safe imperative handle for a Blok editor embedded via
 * `<BlokEditor>`. Solves the "raw ref is `Blok | null` until ready" papercut:
 * instead of every consumer re-declaring a `forwardRef`/`useImperativeHandle`
 * with `?.` guards, `useBlokHandle()` returns this stable object whose methods
 * safely no-op until the editor is ready.
 *
 * Attach it via `ref`: `<BlokEditor ref={handle.ref} … />`. The methods read the
 * live instance through an internal ref, so they can be called from event
 * handlers without re-subscribing, and they stay valid across re-renders.
 *
 * `current` / `isReady` are IMPERATIVE reads (they reflect the instance at call
 * time and do NOT trigger a re-render when readiness flips). For render-reactive
 * readiness use `useBlokReady`; drop to `current` when you need the full editor
 * API beyond the handful of shortcuts below.
 */
export interface BlokEditorHandle {
  /**
   * Ref callback to attach to `<BlokEditor ref={handle.ref} />`. Stable across
   * renders. Stores the live instance (or null before ready / after unmount).
   */
  readonly ref: RefCallback<Blok | null>;
  /** The live editor instance, or null before ready / after unmount. */
  readonly current: Blok | null;
  /** True once the editor is ready (the ref has been populated). */
  readonly isReady: boolean;
  /**
   * Focus the editor. Returns whether focus landed; `false` (no-op) before ready.
   * @param atEnd - place the caret at the end of the focused block
   */
  focus(atEnd?: boolean): boolean;
  /**
   * Clear all content. Resolves immediately (no-op) before ready.
   *
   * Safe to mix with a controlled `data` prop: the adapter's content baseline is
   * updated once the clear lands, so setting `data` back to the document the
   * editor itself emitted re-renders it instead of being dismissed as an echo.
   */
  clear(): Promise<void>;
  /** Serialize the current content, or resolve to `null` before ready. */
  save(): Promise<OutputData | null>;
  /**
   * Render new content in place. Resolves immediately (no-op) before ready.
   *
   * Safe to mix with a controlled `data` prop: the rendered document becomes the
   * adapter's content baseline, so a later `data` change back to the previous
   * document still re-renders.
   * @param data - the document to render
   */
  render(data: OutputData | LooseOutputData): Promise<void>;
  /**
   * Set or toggle read-only mode. Resolves to the resulting state; `false`
   * (no-op) before ready.
   * @param state - explicit state; omit to toggle
   */
  setReadOnly(state?: boolean): Promise<boolean>;
}

/**
 * Returns a stable, null-safe {@link BlokEditorHandle} for a `<BlokEditor>`.
 *
 * @example
 * ```tsx
 * const blok = useBlokHandle();
 * return (
 *   <>
 *     <BlokEditor ref={blok.ref} tools={tools} data={data} />
 *     <button onClick={() => blok.focus()}>Focus</button>
 *     <button onClick={() => blok.save().then(onSubmit)}>Send</button>
 *   </>
 * );
 * ```
 */
export function useBlokHandle(): BlokEditorHandle {
  const instanceRef = useRef<Blok | null>(null);

  // Built once and kept stable: every method reads the live instance through
  // `instanceRef`, so the handle identity (and its ref callback) never changes
  // across renders even as the underlying editor is created or destroyed.
  return useMemo<BlokEditorHandle>(() => ({
    ref: (node): void => {
      instanceRef.current = node;
    },
    get current(): Blok | null {
      return instanceRef.current;
    },
    get isReady(): boolean {
      return instanceRef.current !== null;
    },
    focus: (atEnd?: boolean): boolean => instanceRef.current?.focus(atEnd) ?? false,
    // clear/render change the content OUT OF BAND of the controlled `data`
    // effect, so they report the result to the adapter's content baseline (see
    // content-baseline-map). Reported only once the call RESOLVES: a failed one
    // leaves the editor on its previous content, and a baseline pointing at
    // content the editor never showed would dedupe away the correcting update.
    clear: (): Promise<void> => {
      const instance = instanceRef.current;

      if (instance === null) {
        return Promise.resolve();
      }

      return instance.clear().then(() => {
        getContentBaseline(instance)?.markRendered(EMPTY_OUTPUT_DATA);
      });
    },
    save: (): Promise<OutputData | null> =>
      instanceRef.current !== null ? instanceRef.current.save() : Promise.resolve(null),
    render: (data: OutputData | LooseOutputData): Promise<void> => {
      const instance = instanceRef.current;

      if (instance === null) {
        return Promise.resolve();
      }

      return instance.render(data).then(() => {
        getContentBaseline(instance)?.markRendered(data);
      });
    },
    setReadOnly: (state?: boolean): Promise<boolean> => {
      const instance = instanceRef.current;

      if (instance === null) {
        return Promise.resolve(false);
      }

      // Resolve the toggle here (omitted `state` flips current) so we can use the
      // non-deprecated `set()`, which requires an explicit target state.
      return instance.readOnly.set(state ?? !instance.readOnly.isEnabled);
    },
  }), []);
}
