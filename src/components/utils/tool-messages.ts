/**
 * A tool class lists the English messages its blocks use under this key, as a
 * static getter. Subclasses inherit it. Core adds them to the editor's English
 * before I18n starts. Not versioned, like `blok.toolSheets`, and spelled as a
 * literal in tools for the same reason: esbuild keeps a class whose computed
 * key is an imported binding, and with it every tool.
 */
export const TOOL_MESSAGES = 'blok.toolMessages';

/**
 * Every message the tools in a `tools` config declare, including tools they
 * bring along through `provides` or `companionTools`.
 */
export const messagesOfTools = (tools: unknown): Record<string, string> => {
  const found: Record<string, string> = {};
  const seen = new Set<unknown>();

  const visit = (entry: unknown): void => {
    const toolClass: unknown = typeof entry === 'object' && entry !== null ? (entry as { class?: unknown }).class : entry;

    if (typeof toolClass !== 'function' || seen.has(toolClass)) {
      return;
    }
    seen.add(toolClass);

    const declared: unknown = Reflect.get(toolClass, TOOL_MESSAGES);

    if (typeof declared === 'object' && declared !== null) {
      Object.assign(found, declared);
    }

    const linked = toolClass as { provides?: unknown; companionTools?: unknown };

    [linked.provides, linked.companionTools].forEach((map) => {
      if (typeof map === 'object' && map !== null) {
        Object.values(map).forEach(visit);
      }
    });
  };

  if (typeof tools === 'object' && tools !== null) {
    Object.values(tools).forEach(visit);
  }

  return found;
};
