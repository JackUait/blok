/** Bump when the message envelope changes: tabs on different versions must not merge. */
export const TAB_SYNC_PROTOCOL = 1;

export type IdSource = 'host' | 'persistence' | 'minted' | 'data';

export interface TabKeyInput {
  documentId: string | undefined;
  recordId: string | null;
  idSource: IdSource;
  hasSaved: boolean;
  isEmpty: boolean;
  pathname: string;
}

/**
 * The BroadcastChannel / lock name tabs of one document share, or null when it
 * is not safe to sync. Auto mode adds the path: a host that copies a stored
 * document copies its id, and the copy usually lives at another path.
 * @param input - what this tab knows about its document
 */
export const resolveTabKey = (input: TabKeyInput): string | null => {
  if (typeof input.documentId === 'string' && input.documentId !== '') {
    return `blok-tab:${TAB_SYNC_PROTOCOL}:id:${input.documentId}`;
  }

  if (input.recordId === null || input.isEmpty) {
    return null;
  }

  const trusted = input.idSource === 'persistence'
    || (input.idSource === 'minted' && input.hasSaved);

  return trusted ? `blok-tab:${TAB_SYNC_PROTOCOL}:auto:${input.recordId}:${input.pathname}` : null;
};
