import { useState, useEffect, useRef, useMemo, type DependencyList } from 'react';
import { Blok as BlokRuntime } from '../blok';
import { setHolder, removeHolder } from './holder-map';
import type { Blok } from '@/types';
import type { UseBlokConfig } from './types';

interface EditorInstanceState {
  editor: Blok | null;
  holder: HTMLDivElement | null;
  destroyTimeout: ReturnType<typeof setTimeout> | null;
  isDestroyed: boolean;
  /** Opaque token identifying which deps cycle created this editor */
  depsToken: Record<string, unknown> | null;
}

/**
 * React hook that manages a Blok editor instance lifecycle.
 *
 * Creates a detached holder div, instantiates Blok, and returns the instance
 * once `isReady` resolves. Handles StrictMode double-mount by deferring
 * destroy via `setTimeout(0)` and cancelling on remount.
 *
 * @param config - Blok configuration without `holder` (managed internally)
 * @param deps - Optional dependency array; when values change, the editor is recreated
 * @returns The Blok instance once ready, or null during initialization / SSR
 */
export function useBlok(config: UseBlokConfig, deps?: DependencyList): Blok | null {
  const [editor, setEditor] = useState<Blok | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const stateRef = useRef<EditorInstanceState>({
    editor: null,
    holder: null,
    destroyTimeout: null,
    isDestroyed: false,
    depsToken: null,
  });

  // A new token is created only when deps change (useMemo compares deps).
  // StrictMode re-runs see the SAME token. Deps changes produce a NEW token.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsToken = useMemo(() => ({}), deps ?? []);

  // Main lifecycle effect
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const state = stateRef.current;

    // Cancel pending deferred destroy (StrictMode remount)
    if (state.destroyTimeout !== null) {
      clearTimeout(state.destroyTimeout);
      state.destroyTimeout = null;
    }

    // Reuse editor on StrictMode remount (same deps cycle)
    if (state.editor !== null && !state.isDestroyed && state.depsToken === depsToken) {
      setEditor(state.editor);

      return (): void => {
        deferDestroy(state, setEditor);
      };
    }

    // Destroy leftover editor from a previous deps cycle
    if (state.editor !== null && !state.isDestroyed) {
      removeHolder(state.editor);
      state.editor.destroy();
      state.editor = null;
      state.holder = null;
      state.isDestroyed = true;
      setEditor(null);
    }

    // Create detached holder
    const holder = document.createElement('div');
    state.holder = holder;
    state.isDestroyed = false;
    state.depsToken = depsToken;

    // Wrap callbacks via ref so they never go stale
    const currentConfig = configRef.current;
    const blokConfig = {
      ...currentConfig,
      holder,
      onReady: (): void => {
        configRef.current.onReady?.();
      },
      onChange: (...args: Parameters<NonNullable<UseBlokConfig['onChange']>>): void => {
        configRef.current.onChange?.(...args);
      },
    };

    const blok = new BlokRuntime(blokConfig) as unknown as Blok;
    state.editor = blok;
    setHolder(blok, holder);

    void blok.isReady.then(() => {
      if (state.editor === blok && !state.isDestroyed) {
        setEditor(blok);
      }
    });

    return (): void => {
      deferDestroy(state, setEditor);
    };
  }, [depsToken]);

  // Reactive: readOnly
  const { readOnly } = config;
  useEffect(() => {
    if (editor === null) {
      return;
    }
    void editor.readOnly.set(readOnly ?? false);
  }, [editor, readOnly]);

  // Reactive: autofocus
  const { autofocus } = config;
  useEffect(() => {
    if (editor === null || !autofocus) {
      return;
    }
    editor.focus();
  }, [editor, autofocus]);

  return editor;
}

function deferDestroy(
  state: EditorInstanceState,
  setEditorState: React.Dispatch<React.SetStateAction<Blok | null>>
): void {
  /* eslint-disable no-param-reassign -- intentional mutation of shared state ref */
  state.destroyTimeout = setTimeout(() => {
    if (state.editor !== null) {
      removeHolder(state.editor);
      state.editor.destroy();
      state.editor = null;
      state.holder = null;
      state.isDestroyed = true;
      state.destroyTimeout = null;
      setEditorState(null);
    }
  }, 0);
  /* eslint-enable no-param-reassign */
}
