/**
 * Prop keys that `<BlokEditor>` copies straight into the Blok config (the plain
 * seed/reactive options plus the two return-valued transform hooks). The
 * emit-mapped callbacks — `onReady`/`onChange`/`onSave`/`onAfterRender` — are NOT
 * here: they are derived from Vue emits, gated on listener presence.
 *
 * Any prop on `<BlokEditor>` whose key is NOT a declared prop falls through to
 * the container div via `$attrs` (Vue removes declared props from `$attrs`
 * automatically — the analog of React's manual config/div partition).
 *
 * The compile-time guard in this file (step 14) keeps this list in sync with the
 * adapter's public config surface.
 */
import type { UseBlokConfig } from './types';

export const BLOK_EDITOR_CONFIG_KEYS = [
  'autofocus',
  'defaultBlock',
  'dataModel',
  'placeholder',
  'sanitizer',
  'hideToolbar',
  'maxHistoryLength',
  'historyDebounceTime',
  'newGroupDelay',
  'globalUndoRedo',
  'tools',
  'data',
  'minHeight',
  'logLevel',
  'readOnly',
  'i18n',
  'link',
  'linkPaste',
  'inlineToolbar',
  'tunes',
  'style',
  'theme',
  'scrollToBlock',
  'user',
  'resolveUser',
  'notifierPosition',
  'notifier',
  'width',
  'onBeforeRender',
  'onBeforePaste',
] as const satisfies readonly (keyof UseBlokConfig)[];

export type BlokEditorConfigKey = (typeof BLOK_EDITOR_CONFIG_KEYS)[number];

/**
 * Config callbacks that `<BlokEditor>` surfaces as Vue emits (gated on listener
 * presence) instead of declared props.
 */
export type EmitMappedConfigKey = 'onReady' | 'onChange' | 'onSave' | 'onAfterRender' | 'onThemeChange';

/**
 * Compile-time exhaustiveness guard: every `UseBlokConfig` key must be either a
 * declared `<BlokEditor>` prop (`BLOK_EDITOR_CONFIG_KEYS`) or emit-mapped. If a
 * new `BlokConfig` key is added and not handled here, `_uncovered` reds under
 * `tsc`, forcing the adapter (and `types/vue.d.ts`) to keep pace.
 */
type _UncoveredConfigKey = Exclude<keyof UseBlokConfig, BlokEditorConfigKey | EmitMappedConfigKey>;
const _uncovered: _UncoveredConfigKey extends never ? true : never = true;

void _uncovered;
