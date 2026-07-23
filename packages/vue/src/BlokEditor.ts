import { computed, defineComponent, getCurrentInstance, h, watch, type PropType } from 'vue';
import { useBlok } from './useBlok';
import { BlokContent } from './BlokContent';
import { BLOK_EDITOR_CONFIG_KEYS } from './config-keys';
import type {
  API,
  BlockMutationEvent,
  BlokConfig,
  EditorWidth,
  OutputData,
  ResolvedTheme,
  ThemeMode,
} from '@/types';
import type { UseBlokConfig } from './types';

/**
 * The blessed all-in-one component for embedding Blok in Vue. Wires `useBlok`
 * and `BlokContent`, maps Vue emits onto the core config callbacks (gated on
 * listener presence, since their mere presence makes core do extra work), and
 * threads the return-valued transform hooks through.
 *
 * Every declared prop is removed from `$attrs`, so any extra attribute
 * (`id`/`class`/`aria-*`/`data-*`) falls through to the editor container.
 */
export const BlokEditor = defineComponent({
  name: 'BlokEditor',
  // Bind fallthrough attrs explicitly onto the container (below) instead of
  // relying on implicit double-fallthrough through BlokContent.
  inheritAttrs: false,
  // Reactive config + seed props. `default: undefined` on the boolean props keeps
  // an unset prop `undefined` (Vue otherwise coerces absent Boolean props to
  // false), so `provideBlok` defaults can apply and core can coerce.
  props: {
    autofocus: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    defaultBlock: { type: String, default: undefined },
    dataModel: { type: String as PropType<BlokConfig['dataModel']>, default: undefined },
    placeholder: { type: [String, Boolean] as PropType<string | false>, default: undefined },
    sanitizer: { type: Object as PropType<BlokConfig['sanitizer']>, default: undefined },
    hideToolbar: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    maxHistoryLength: { type: Number, default: undefined },
    historyDebounceTime: { type: Number, default: undefined },
    newGroupDelay: { type: Number, default: undefined },
    globalUndoRedo: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    tools: { type: Object as PropType<BlokConfig['tools']>, default: undefined },
    data: { type: Object as PropType<OutputData>, default: undefined },
    minHeight: { type: Number, default: undefined },
    logLevel: { type: String as PropType<BlokConfig['logLevel']>, default: undefined },
    // [Boolean, Object]: the object form ({ hideControls }) must not be dropped
    // or dev-warned — it always means read-only enabled (reactive contract).
    readOnly: { type: [Boolean, Object] as PropType<BlokConfig['readOnly']>, default: undefined },
    i18n: { type: Object as PropType<BlokConfig['i18n']>, default: undefined },
    link: { type: Object as PropType<BlokConfig['link']>, default: undefined },
    linkPaste: { type: Object as PropType<BlokConfig['linkPaste']>, default: undefined },
    inlineToolbar: { type: [Array, Boolean] as PropType<string[] | boolean>, default: undefined },
    tunes: { type: Array as PropType<string[]>, default: undefined },
    style: { type: Object as PropType<BlokConfig['style']>, default: undefined },
    theme: { type: String as PropType<ThemeMode>, default: undefined },
    scrollToBlock: { type: Object as PropType<BlokConfig['scrollToBlock']>, default: undefined },
    user: { type: Object as PropType<BlokConfig['user']>, default: undefined },
    resolveUser: { type: Function as PropType<BlokConfig['resolveUser']>, default: undefined },
    notifierPosition: { type: String as PropType<BlokConfig['notifierPosition']>, default: undefined },
    notifier: { type: Function as PropType<BlokConfig['notifier']>, default: undefined },
    width: { type: String as PropType<EditorWidth>, default: undefined },
    onBeforeRender: { type: Function as PropType<BlokConfig['onBeforeRender']>, default: undefined },
    onBeforePaste: { type: Function as PropType<BlokConfig['onBeforePaste']>, default: undefined },
    // Return-valued hook (the boolean is the "handled" signal), so it is a
    // declared prop copied into the config — not an emit-mapped callback.
    onEnter: { type: Function as PropType<BlokConfig['onEnter']>, default: undefined },
    // Fire-and-forget submit hook (Enter-to-send) — a declared prop copied into
    // config, delivering the serialized document.
    onSubmit: { type: Function as PropType<BlokConfig['onSubmit']>, default: undefined },
    // Fire-and-forget error channel — a plain declared prop copied into config.
    onError: { type: Function as PropType<BlokConfig['onError']>, default: undefined },
    /** Changing this prop's identity destroys and recreates the editor. */
    recreateKey: { type: null as unknown as PropType<unknown> },
  },
  emits: {
    ready: (_instance: unknown): boolean => true,
    change: (_payload: { api: API; event: BlockMutationEvent | BlockMutationEvent[] }): boolean => true,
    save: (_data: OutputData): boolean => true,
    'update:data': (_data: OutputData): boolean => true,
    'after-render': (_api: API): boolean => true,
    'theme-change': (_theme: ResolvedTheme): boolean => true,
    'blocks-rendered': (_payload: unknown): boolean => true,
    'block-rendered': (_payload: unknown): boolean => true,
  },
  setup(props, { emit, expose, attrs }) {
    const instance = getCurrentInstance();

    /** Listener presence (the Vue analog of Angular's `output.observed`). */
    const hasListener = (handlerKey: string): boolean => {
      const vnodeProps = instance?.vnode.props;

      return vnodeProps != null && handlerKey in vnodeProps;
    };

    /**
     * Snapshot the props + gated emit-callbacks into a `UseBlokConfig`. App-wide
     * `provideBlok` defaults are merged in by `useBlok` (the lifecycle engine),
     * so this component stays thin and the escape-hatch path honors defaults too
     * — mirroring React, where only `useBlok` merges.
     */
    const buildConfig = (): UseBlokConfig => {
      const config: Record<string, unknown> = {};

      for (const key of BLOK_EDITOR_CONFIG_KEYS) {
        const value = props[key];

        if (value !== undefined) {
          config[key] = value;
        }
      }

      if (hasListener('onChange')) {
        config.onChange = (api: API, event: BlockMutationEvent | BlockMutationEvent[]): void => {
          emit('change', { api, event });
        };
      }

      // onSave makes core serialize on every change batch — wire it only when a
      // v-model:data binding or an explicit @save listener consumes it.
      if (hasListener('onSave') || hasListener('onUpdate:data')) {
        config.onSave = (data: OutputData): void => {
          emit('update:data', data);
          emit('save', data);
        };
      }

      if (hasListener('onAfterRender')) {
        config.onAfterRender = (api: API): void => {
          emit('after-render', api);
        };
      }

      if (hasListener('onThemeChange')) {
        config.onThemeChange = (resolved: ResolvedTheme): void => {
          emit('theme-change', resolved);
        };
      }

      return config;
    };

    const editor = useBlok(
      () => buildConfig(),
      () => props.recreateKey
    );

    // Subscribe to the editor's rendered-lifecycle events once it exists (gated
    // on the emits being listened). `onCleanup` unsubscribes when the instance is
    // replaced or the component unmounts.
    watch(editor, (ed, _previous, onCleanup) => {
      if (ed === null) {
        return;
      }

      const subscriptions: Array<[string, (payload?: unknown) => void]> = [];

      if (hasListener('onBlocksRendered')) {
        const handler = (payload?: unknown): void => emit('blocks-rendered', payload);

        ed.on('blocks:rendered', handler);
        subscriptions.push(['blocks:rendered', handler]);
      }

      if (hasListener('onBlockRendered')) {
        const handler = (payload?: unknown): void => emit('block-rendered', payload);

        ed.on('block:rendered', handler);
        subscriptions.push(['block:rendered', handler]);
      }

      onCleanup(() => {
        for (const [name, handler] of subscriptions) {
          ed.off(name, handler);
        }
      });
    });

    // Emit `ready` once per editor, after the instance is published to the ref
    // (and to `expose` below), so a consumer reading the instance inside the
    // handler — or via a template ref — sees the live editor. The last-emitted
    // instance is held in an object to avoid `let` reassignment.
    const readyState: { last: typeof editor.value } = { last: null };

    watch(editor, (ed) => {
      if (ed !== null && ed !== readyState.last) {
        readyState.last = ed;
        emit('ready', ed);
      }
    });

    // Curated imperative facade (delegates to the live instance; no-ops until
    // ready). `instance` is live (null before ready, the Blok after).
    expose({
      instance: computed(() => editor.value),
      save: (): ReturnType<NonNullable<typeof editor.value>['save']> | undefined => editor.value?.save(),
      focus: (atEnd?: boolean): void => {
        editor.value?.focus(atEnd);
      },
      render: (data: OutputData): ReturnType<NonNullable<typeof editor.value>['render']> | undefined =>
        editor.value?.render(data),
    });

    return () => h(BlokContent, { editor: editor.value, ...attrs });
  },
});
