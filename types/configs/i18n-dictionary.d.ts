/**
 * Structure of the i18n dictionary - flat key-value pairs.
 *
 * Keys use dot notation to represent the translation path. The first segment is
 * the namespace; the documented namespaces are:
 * - `toolNames.<name>` — a tool's toolbox/display label (`<name>` is the tool's
 *   registration name). See {@link ToolNameMessageKey}. Custom tools use the
 *   same convention: registering a tool as `myTool` makes its label key
 *   `toolNames.myTool`, with no extra wiring.
 * - `tools.<tool>.<key>` — a tool's own strings (`tools.link.addLink`).
 * - `blockSettings.<key>` — block settings menu strings.
 * - `popover.<key>` — popover component strings.
 * - `a11y.<key>` — accessibility / screen-reader strings.
 *
 * Example:
 * {
 *   "toolNames.text": "Текст",
 *   "tools.link.addLink": "Добавить ссылку",
 *   "popover.search": "Поиск"
 * }
 *
 * Intentionally loose (`Record<string, string>`) so custom-tool keys are
 * accepted. For rename-safe overrides of BUILT-IN keys, type your overrides as
 * {@link BlokMessages} (a `satisfies` opt-in checked against the generated
 * {@link BlokMessageKey} union) — see `types/message-keys.d.ts`.
 */
export type I18nDictionary = Record<string, string>;

export type { BlokMessageKey, BlokMessages, ToolNameMessageKey } from '../message-keys';

