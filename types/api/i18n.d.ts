/**
 * Describes Blok's I18n API for tools
 */
export interface I18n {
  /**
   * Translate a key from the global dictionary.
   * Keys should be fully qualified (e.g., 'tools.link.addLink', 'blockSettings.delete').
   *
   * @param dictKey - Full translation key to look up
   * @param vars - Optional string or number values to interpolate into placeholders
   * @returns Translated string, or the key itself if translation is missing
   *
   * @example
   * api.i18n.t('tools.image.emptyMaxSize', { size: '10 MB' })
   */
  t(
    dictKey: string,
    vars?: Record<string, string | number>
  ): string;

  /**
   * Check if a translation exists for the given key.
   *
   * @param dictKey - Full translation key to check
   * @returns True if translation exists, false otherwise
   */
  has(dictKey: string): boolean;

  /**
   * Get the English translation for a key.
   * Used for multilingual search - always searches against English terms.
   *
   * @param key - Translation key (e.g., 'toolNames.heading')
   * @returns English translation string, or empty string if not found
   */
  getEnglishTranslation(key: string): string;

  /**
   * Get the current locale code.
   *
   * @returns The active locale code (e.g., 'en', 'fr', 'ja')
   */
  getLocale(): string;
}

/**
 * Options accepted by {@link EditorI18n.update}.
 *
 * Mirrors the live subset of `config.i18n`. `defaultLocale` is absent by
 * design: it only decides the fallback used while resolving the initial
 * locale, so changing it after mount cannot affect anything.
 */
export interface I18nUpdateOptions {
  /**
   * Locale to switch to. `'auto'` re-runs browser-locale detection.
   */
  locale?: string;

  /**
   * Host message overrides, merged over the locale's dictionary.
   *
   * Merge (not replace) semantics, matching `setDictionary`: keys accumulate
   * across calls and are re-applied automatically after every locale change,
   * so a locale flip never silently drops them.
   */
  messages?: Record<string, string>;

  /**
   * Explicit text direction, overriding the direction implied by the locale.
   * Omit it to let the locale decide — which is what a language switcher
   * wants, since the implied direction is already correct.
   */
  direction?: 'ltr' | 'rtl';
}

/**
 * The i18n API as seen by the host application: everything tools get
 * ({@link I18n}) plus the runtime mutator.
 *
 * Reachable as `blok.i18n`. It is an own property of the editor instance, so
 * it shadows the read-only `I18n` that the API prototype exposes to tools —
 * a third-party tool receiving `api.i18n` cannot flip the host's locale.
 */
export interface EditorI18n extends I18n {
  /**
   * Get the text direction currently in effect.
   *
   * Derived from the active locale unless the host set an explicit direction.
   * Declared here rather than on {@link I18n} so adding it stays a additive
   * change: `I18n` is hand-implemented by tool test harnesses and mocks, and a
   * new required member there would break every one of them.
   *
   * @returns 'rtl' for right-to-left locales, otherwise 'ltr'
   */
  getDirection(): 'ltr' | 'rtl';

  /**
   * Applies a new locale and/or message overrides in place.
   *
   * `config.i18n` is read once at mount, so without this a host with a
   * language switcher had to recreate the editor — losing caret, focus,
   * selection and undo history. This relabels the editor chrome instead.
   *
   * Calls are serialized internally, so lazily-loaded locale chunks cannot
   * land out of order: the last call always wins.
   *
   * Scope: everything. Chrome built on demand (block settings, the convert
   * menu, notifications, screen-reader announcements) picks up the new locale
   * the next time it opens; the eagerly-stamped chrome (toolbar and plus-button
   * labels, tooltips, the toolbox list) is relabelled immediately; and text a
   * tool already rendered inside a block — placeholders, media-toolbar labels,
   * cell controls — is repainted from your data, tools included that know
   * nothing about locale changes. The repaint is invisible: it does not fire
   * `onChange`, does not touch the undo history, and returns the caret to the
   * block that had it.
   *
   * @param options - the locale, message overrides and/or direction to apply
   * @returns a promise resolving once the locale chunk is loaded and applied
   */
  update(options: I18nUpdateOptions): Promise<void>;
}
