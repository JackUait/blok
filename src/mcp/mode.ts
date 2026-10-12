import { surfaceError } from './errors';

/**
 * Spec §3.6: a stored PUT next to a live room would be overwritten or force a
 * reset, so stored is refused whenever a sync URL is configured, even read-only.
 */
export const resolveMode = (requested: 'auto' | 'live' | 'stored', syncConfigured: boolean): 'live' | 'stored' => {
  if (requested === 'stored' && syncConfigured) {
    throw surfaceError(
      'STORED_WRITE_FORBIDDEN',
      'A live room owns this document, so stored edits would be overwritten. Open it with mode "live" or "auto".',
    );
  }
  if (requested === 'live' && !syncConfigured) {
    throw surfaceError('INVALID_ARGS', 'Live mode needs blok-mcp to run with --sync-url.');
  }
  if (requested === 'auto') {
    return syncConfigured ? 'live' : 'stored';
  }

  return requested;
};
