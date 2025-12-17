import type EnglishMessages from '../../src/components/i18n/locales/en/messages.json';

/**
 * All valid translation keys in the i18n system.
 * This type is derived from the English messages JSON and ensures
 * compile-time checking for translation key validity.
 */
export type TranslationKey = keyof typeof EnglishMessages;

/**
 * Structure of the i18n dictionary - flat key-value pairs
 *
 * Keys use dot notation to represent the translation path:
 * - "toolNames.text" - Tool name translations
 * - "tools.link.addLink" - Tool-specific translations
 * - "blockTunes.delete.delete" - Block tune translations
 * - "ui.popover.search" - UI component translations
 * - "accessibility.dragHandle.aria-label" - Accessibility translations
 *
 * Example:
 * {
 *   "toolNames.text": "Текст",
 *   "tools.link.addLink": "Добавить ссылку",
 *   "ui.popover.search": "Поиск"
 * }
 */
export type I18nDictionary = Record<string, string>;

