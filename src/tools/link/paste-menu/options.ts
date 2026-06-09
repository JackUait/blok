import { isHttpUrl, matchEmbedService } from '../registry';

/** The four outputs Notion offers for a pasted URL. */
export type PasteMenuActionType = 'embed' | 'bookmark' | 'mention' | 'plain';

export interface PasteMenuOption {
  type: PasteMenuActionType;
}

export interface PasteMenuContext {
  /** Whether the paste lands on a non-collapsed text selection. */
  hasSelection: boolean;
}

/**
 * Decides which paste-menu options apply to a pasted URL.
 *
 * - With a text selection, Notion simply hyperlinks it — only `plain`.
 * - `embed` only for a registered provider (most specific, listed first).
 * - `bookmark` and `mention` for any safe http(s) URL.
 * - `plain` is always available (dismiss / keep as link).
 */
export function buildPasteMenuOptions(
  url: string,
  context: PasteMenuContext
): PasteMenuOption[] {
  if (context.hasSelection || !isHttpUrl(url)) {
    return [{ type: 'plain' }];
  }

  const options: PasteMenuOption[] = [];

  if (matchEmbedService(url)) {
    options.push({ type: 'embed' });
  }

  options.push({ type: 'bookmark' }, { type: 'mention' }, { type: 'plain' });

  return options;
}
