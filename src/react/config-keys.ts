import type { UseBlokConfig } from './types';

/**
 * Keys that belong to the editor config (consumed by `useBlok`). Any prop on
 * `BlokEditor` whose key is NOT in this set is treated as a container div
 * attribute and spread onto the underlying element (mirrors `BlokContent`).
 *
 * Keep in sync with `UseBlokConfig`. The two compile-time guards below fail the
 * `yarn lint:types` typecheck if this list drifts.
 */
export const USE_BLOK_CONFIG_KEYS = [
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
  'onBeforePaste',
  'onReady',
  'onChange',
  'inlineToolbar',
  'tunes',
  'style',
  'theme',
  'onThemeChange',
  'scrollToBlock',
  'user',
  'resolveUser',
  'notifierPosition',
  'notifier',
  'width',
] as const satisfies readonly (keyof UseBlokConfig)[];

/**
 * Compile error if a `UseBlokConfig` key is missing from the list above.
 * (`satisfies` only proves each entry is a valid key; this proves coverage.)
 */
type _MissingConfigKey = Exclude<keyof UseBlokConfig, (typeof USE_BLOK_CONFIG_KEYS)[number]>;
const _exhaustive: _MissingConfigKey extends never ? true : never = true;

void _exhaustive;
