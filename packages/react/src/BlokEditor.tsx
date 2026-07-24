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
import type { Blok, BlockRenderedPayload, BlocksRenderedPayload } from '@/types';
import type { UseBlokConfig } from './types';

/**
 * Props for the all-in-one BlokEditor component.
 * Accepts every useBlok config prop (except `onReady`, re-typed below to receive
 * the ready instance) AND every standard HTML div attribute, which is forwarded
 * to the editor container element (mirrors `BlokContent`). `style` and `onChange`
 * keep their editor-config meaning (they collide with div attributes of the same
 * name), so the container is styled via `className` rather than an inline `style`.
 *
 * `data` is reactive (controlled-ish): it seeds the INITIAL content and, after
 * mount, changing it to new *content* re-renders the editor via `render()` — no
 * recreation. Updates are deep-equal–deduped (a new reference with identical
 * content is a no-op, so it won't clobber the caret) and serialized (rapid
 * changes can't overlap). For ad-hoc reloads you can still call
 * `ref.current.render(newData)`.
 *
 * Pair `data` with `onSave` for a true controlled component: `onSave` is the
 * output half, firing (debounced) with the full serialized `OutputData` on every
 * content change — no manual `ref.current.save()` polling. Echoing that payload
 * straight back via `onSave={setData}` is safe and caret-stable: the adapter
 * records the editor's own emitted output as the content baseline, so the
 * `onSave → setState → data` round-trip deep-equals that baseline and is deduped
 * to a no-op (no re-render, no caret reset, no recursion). Genuine external `data`
 * changes still re-render in place.
 */
export interface BlokEditorProps
  extends Omit<UseBlokConfig, 'onReady'>,
    // `onChange`/`onError`/`onSubmit` are Blok config callbacks here — drop the
    // DOM element's same-named event handlers so the config signatures win.
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'onChange' | 'onError' | 'onSubmit'> {
  /**
   * When any value changes, the editor is destroyed and recreated. Keep each
   * value referentially stable (primitives or useMemo-stable objects) — a dep
   * whose identity changes every render recreates the editor each time.
   *
   * Tool configs do NOT belong here — reserve deps for true identity changes
   * (e.g. the document id). FUNCTIONS inside tool configs are re-bound to the
   * latest render's closure automatically (an inline `uploadByFile` with a
   * fresh identity each render reaches the editor live), and non-function
   * config VALUES of `createReactBlock` tools (permissions, URLs, locale…) are
   * pushed to mounted blocks in place when they change. Neither requires
   * recreation or `useState` identity-freezing.
   */
  deps?: DependencyList;
  /** Test id forwarded to the editor container element (via data-testid). */
  'data-testid'?: string;
  /**
   * Called with the live Blok instance once it is ready. Fires after the
   * forwarded ref is committed, so `ref.current` is also populated at this point.
   *
   * Contract: fires exactly once per editor instance. The editor is recreated
   * only when `deps` change or the component remounts; `data` changes —
   * including transitions to and from empty content — re-render in place and
   * never recreate the editor or re-fire `onReady`.
   */
  onReady?: (editor: Blok) => void;
  /**
   * Library-neutral shorthand for the active locale — a plain BCP-47 string
   * (`'en'`, `'ru-RU'`, `'nb'`) the host owns and updates. It is normalized and
   * routed to `editor.i18n.update({ locale })` in place (caret/undo survive),
   * so a host with its own language switcher never has to build an `i18n`
   * config object or destroy the editor. Pair it with the re-exported
   * `getDirection`/`normalizeLocale` to compute `dir` yourself.
   *
   * Shorthand for `i18n={{ locale }}`: if both are given, this wins. For
   * message overrides or an explicit direction, use the full `i18n` prop.
   */
  locale?: string;
  /**
   * Called after a batch render completes (core `blocks:rendered` event). The
   * declarative analog of `ref.current.on('blocks:rendered', …)` — mirrors the
   * Vue/Angular adapters' rendered-lifecycle outputs.
   */
  onBlocksRendered?: (payload: BlocksRenderedPayload) => void;
  /** Called for each block rendered into the DOM (core `block:rendered` event). */
  onBlockRendered?: (payload: BlockRenderedPayload) => void;
}

/** Fast membership test for partitioning props into editor config vs. div attributes. */
const CONFIG_KEY_SET = new Set<string>(USE_BLOK_CONFIG_KEYS);

/**
 * The recommended way to embed Blok in React. Internally wires `useBlok` and
 * `BlokContent`, and forwards a ref to the live `Blok` instance.
 *
 * Don't wrap this component in `styled()` or any HOC that reserves the `theme`
 * prop — styled-components claims `theme` for its own `ThemeProvider`, so it
 * never reaches the editor and theme sync silently breaks. Render it directly
 * and style the container via `className`.
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} id="editor" tools={tools} data={data} theme={theme} onReady={(e) => e.focus()} />;
 * ```
 */
export const BlokEditor = forwardRef<Blok | null, BlokEditorProps>(
  function BlokEditor({ deps, onReady, locale, onBlocksRendered, onBlockRendered, ...rest }, ref) {
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

    // `locale` is a neutral shorthand for `i18n.locale`. Fold it into the i18n
    // config (winning over any locale already there) so the single reactive
    // `i18n.update` path in `useBlok` carries it — no separate resolver. A fresh
    // object each render is fine: that path is deep-equal–deduped.
    if (locale !== undefined) {
      const existingI18n = config.i18n as Record<string, unknown> | undefined;

      config.i18n = { ...existingI18n, locale };
    }

    const editor = useBlok(config, deps);

    useImperativeHandle<Blok | null, Blok | null>(ref, () => editor, [editor]);

    // Own onReady here instead of forwarding it to the core config: the core
    // onReady fires before useImperativeHandle commits the ref. This passive
    // effect runs AFTER the commit, so both the instance argument and ref.current
    // are reliably populated.
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    // Hardening, not a bug fix: today this effect only re-runs when `editor`
    // changes, but future React semantics (Fast Refresh, <Activity>) may re-run
    // an effect with an unchanged value. Tracking the last-notified instance
    // guarantees at-most-once per instance while keeping the per-instance
    // re-fire on recreation (deps change / remount) intact.
    const notifiedEditorRef = useRef<Blok | null>(null);
    useEffect(() => {
      if (editor !== null && notifiedEditorRef.current !== editor) {
        notifiedEditorRef.current = editor;
        onReadyRef.current?.(editor);
      }
    }, [editor]);

    // Subscribe to the rendered-lifecycle events (the declarative analog of the
    // Vue/Angular outputs). Latest handlers are read through refs so a new
    // callback identity never resubscribes; presence booleans in the deps add or
    // drop subscriptions when a handler appears/disappears.
    const onBlocksRenderedRef = useRef(onBlocksRendered);
    onBlocksRenderedRef.current = onBlocksRendered;
    const onBlockRenderedRef = useRef(onBlockRendered);
    onBlockRenderedRef.current = onBlockRendered;

    const hasBlocksRendered = Boolean(onBlocksRendered);
    const hasBlockRendered = Boolean(onBlockRendered);
    useEffect(() => {
      if (editor === null) {
        return;
      }

      const subscriptions: Array<[string, (payload?: unknown) => void]> = [];

      if (hasBlocksRendered) {
        const handler = (payload?: unknown): void =>
          onBlocksRenderedRef.current?.(payload as BlocksRenderedPayload);

        editor.on('blocks:rendered', handler);
        subscriptions.push(['blocks:rendered', handler]);
      }

      if (hasBlockRendered) {
        const handler = (payload?: unknown): void =>
          onBlockRenderedRef.current?.(payload as BlockRenderedPayload);

        editor.on('block:rendered', handler);
        subscriptions.push(['block:rendered', handler]);
      }

      return (): void => {
        for (const [name, handler] of subscriptions) {
          editor.off(name, handler);
        }
      };
    }, [editor, hasBlocksRendered, hasBlockRendered]);

    return <BlokContent editor={editor} {...(divProps as HTMLAttributes<HTMLDivElement>)} />;
  }
);
