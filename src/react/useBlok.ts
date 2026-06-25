import { useState, useEffect, useRef, useMemo, type DependencyList } from 'react';
import { Blok as BlokRuntime } from '../blok';
import { setHolder, removeHolder } from './holder-map';
import { deepEqual } from './deep-equal';
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

  // Tracks the data the editor currently reflects — set when content is seeded
  // or rendered (the reactive `data` effect below) AND when the editor emits its
  // own serialized content via `onSave`. The latter is what makes a controlled
  // `onSave -> setData -> data` round-trip a no-op: the echoed payload deep-equals
  // this baseline, so the data effect skips the redundant render() (which would
  // otherwise reset the caret). Declared here so the `onSave` wrapper below can
  // update it before the consumer's setState re-runs the data effect.
  const lastRenderedDataRef = useRef(config.data);
  const seededEditorRef = useRef<Blok | null>(null);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());

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
      try {
        state.editor.destroy();
      } catch {
        // destroy may throw — still clean up state
      }
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

    // Only attach onSave when the consumer opted in: its mere presence makes the
    // core serialize on every change batch, so an absent prop must stay absent.
    // The wrapper reads through the ref so the latest callback is always used.
    if (currentConfig.onSave) {
      blokConfig.onSave = (...args: Parameters<NonNullable<UseBlokConfig['onSave']>>): void => {
        // Record the editor's own serialized output as the rendered baseline so a
        // controlled consumer echoing it straight back into `data` is a no-op —
        // no redundant render(), no caret reset, no round-trip recursion.
        lastRenderedDataRef.current = args[0];
        configRef.current.onSave?.(...args);
      };
    }

    // onBeforeRender / onAfterRender are opt-in (absent prop must stay absent so
    // the core skips them). When present, route through the ref so the latest
    // callback is always used without recreating the editor.
    if (currentConfig.onBeforeRender) {
      blokConfig.onBeforeRender = (
        ...args: Parameters<NonNullable<UseBlokConfig['onBeforeRender']>>
      ): ReturnType<NonNullable<UseBlokConfig['onBeforeRender']>> =>
        configRef.current.onBeforeRender?.(...args) ?? args[0];
    }

    if (currentConfig.onAfterRender) {
      blokConfig.onAfterRender = (...args: Parameters<NonNullable<UseBlokConfig['onAfterRender']>>): void => {
        configRef.current.onAfterRender?.(...args);
      };
    }

    const blok = new BlokRuntime(blokConfig) as unknown as Blok;
    state.editor = blok;
    setHolder(blok, holder);

    void blok.isReady
      .then(() => {
        if (state.editor === blok && !state.isDestroyed) {
          setEditor(blok);
        }
      })
      .catch(() => {
        if (state.editor === blok && !state.isDestroyed) {
          removeHolder(blok);
          try {
            blok.destroy();
          } catch {
            // destroy may also throw — still clean up state
          }
          state.editor = null;
          state.holder = null;
          state.isDestroyed = true;
          setEditor(null);
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

  // Reactive: theme
  const { theme } = config;
  useEffect(() => {
    if (editor === null || theme === undefined) {
      return;
    }
    editor.theme.set(theme);
  }, [editor, theme]);

  // Reactive: width
  const { width } = config;
  useEffect(() => {
    if (editor === null || width === undefined) {
      return;
    }
    editor.width.set(width);
  }, [editor, width]);

  // Reactive: placeholder
  const { placeholder } = config;
  useEffect(() => {
    if (editor === null || placeholder === undefined) {
      return;
    }
    editor.placeholder.set(placeholder);
  }, [editor, placeholder]);

  // Reactive: data (controlled content)
  //
  // `data` seeds the editor at construction. Afterwards, changing the prop to
  // new *content* re-renders the editor via the public render() API — no
  // recreation. Updates are deep-equal–deduped against the editor's current
  // content baseline (`lastRenderedDataRef`, declared above and also updated by
  // the `onSave` wrapper) so a new reference with the same content — including
  // the editor's own serialized output echoed back — is a no-op and won't
  // clobber the caret. Renders are serialized so rapid changes can't overlap.
  const { data } = config;
  useEffect(() => {
    if (editor === null || data === undefined) {
      return;
    }

    // A freshly created editor was already seeded with `data` at construction;
    // record it without re-rendering.
    if (seededEditorRef.current !== editor) {
      seededEditorRef.current = editor;
      lastRenderedDataRef.current = data;

      return;
    }

    // Unchanged content — skip the redundant render.
    if (deepEqual(data, lastRenderedDataRef.current)) {
      return;
    }

    lastRenderedDataRef.current = data;
    renderChainRef.current = renderChainRef.current
      .catch(() => undefined)
      .then(() => editor.render(data));
  }, [editor, data]);

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
      try {
        state.editor.destroy();
      } catch {
        // destroy may throw — still clean up state
      }
      state.editor = null;
      state.holder = null;
      state.isDestroyed = true;
      state.destroyTimeout = null;
      setEditorState(null);
    }
  }, 0);
  /* eslint-enable no-param-reassign */
}
