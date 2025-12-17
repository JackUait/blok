/**
 * Structure of the i18n dictionary - flat key-value pairs
 *
 * Keys use dot notation to represent the translation path:
 * - "toolNames.text" - Tool name translations
 * - "tools.link.addLink" - Tool-specific translations
 * - "blockSettings.delete" - Block settings translations
 * - "popover.search" - Popover component translations
 * - "a11y.dragHandle" - Accessibility translations
 *
 * Example:
 * {
 *   "toolNames.text": "Текст",
 *   "tools.link.addLink": "Добавить ссылку",
 *   "popover.search": "Поиск"
 * }
 */
export type I18nDictionary = Record<string, string>;

