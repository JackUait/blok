/**
 * Structure of the i18n dictionary - flat key-value pairs
 *
 * Keys use dot notation to represent the translation path:
 * - "toolNames.Text" - Tool name translations
 * - "tools.link.Add a link" - Tool-specific translations
 * - "blockTunes.delete.Delete" - Block tune translations
 * - "ui.popover.Search" - UI component translations
 * - "accessibility.dragHandle.aria-label" - Accessibility translations
 *
 * Example:
 * {
 *   "toolNames.Text": "Текст",
 *   "tools.link.Add a link": "Добавить ссылку",
 *   "ui.popover.Search": "Поиск"
 * }
 */
export type I18nDictionary = Record<string, string>;

