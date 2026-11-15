import type { CollaborationStatusChangedPayload } from '../../types/events/editor-events';

/** Presentation only: remote edits remain in the editor's in-memory queue. */
export function createWorkspaceSaveStatus(remote: boolean, online = navigator.onLine) {
  const element = document.createElement('span');
  element.setAttribute('data-desktop-status', '');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  let connection: string = 'connecting';
  let save: CollaborationStatusChangedPayload['save'];
  let pending = 0;
  let ready = false;
  const failures = new Map<string, { label: string; detail: string; network: boolean }>();
  const paint = (): void => {
    const failure = [...failures.values()].find((item) => !item.network) ?? [...failures.values()].at(-1);
    let state: string;
    let label: string;
    let detail: string;
    if (failure && !failure.network) {
      state = 'error'; label = failure.label; detail = failure.detail;
    } else if (remote && (save?.state === 'blocked' || save?.state === 'quarantined' || connection === 'error')) {
      state = 'error'; label = 'Enregistrement interrompu';
      detail = 'Les modifications ne peuvent pas être envoyées. Gardez cette page ouverte et vérifiez votre accès à l’espace.';
    } else if (remote && (!online || connection === 'offline' || failure?.network)) {
      state = 'offline';
      const unsaved = pending > 0 || failure !== undefined || save?.state === 'pending' || (save?.pendingOperations ?? 0) > 0 || (save?.pendingBytes ?? 0) > 0;
      label = unsaved ? 'Hors-ligne · non enregistré' : 'Hors-ligne';
      detail = unsaved
        ? 'Des modifications attendent leur enregistrement sur le serveur. Gardez cette page ouverte jusqu’à la fin de la synchronisation.'
        : 'Connexion au serveur interrompue. La reconnexion est automatique.';
    } else if (pending > 0 || (remote && (save?.state === 'pending' || (save?.pendingOperations ?? 0) > 0 || (save?.pendingBytes ?? 0) > 0))) {
      state = 'pending'; label = remote ? 'Synchronisation…' : 'Enregistrement…';
      detail = remote ? 'Des modifications attendent leur confirmation par le serveur.' : 'Enregistrement sur cet appareil en cours.';
    } else if (remote && (connection !== 'connected' || save?.state !== 'saved')) {
      state = 'connecting'; label = connection === 'connected' ? 'Confirmation en attente' : 'Connexion…';
      detail = 'L’enregistrement sur le serveur n’est pas encore confirmé.';
    } else if (!remote && !ready) {
      state = 'loading'; label = 'Ouverture…'; detail = 'Chargement de la page sur cet appareil.';
    } else {
      state = 'saved'; label = remote ? 'Enregistré' : 'Sur cet appareil';
      detail = remote ? 'Toutes les modifications ont été confirmées par le serveur.' : 'Cette page est enregistrée sur cet appareil.';
    }
    element.textContent = label;
    element.title = detail;
    element.setAttribute('aria-label', `${label}. ${detail}`);
    element.setAttribute('data-sync-state', state);
    element.toggleAttribute('data-error', state === 'error');
  };
  paint();
  return {
    element,
    connection(event?: Partial<CollaborationStatusChangedPayload>) {
      if (event?.status) connection = event.status;
      if (event?.save) save = event.save;
      // A connection event cannot acknowledge a failed metadata save.
      paint();
    },
    resetPage() { connection = 'connecting'; save = undefined; ready = false; paint(); },
    ready() { ready = true; paint(); },
    online(value: boolean) { online = value; paint(); },
    pending(value: number) { pending = value; paint(); },
    error(error: unknown, refusal?: string | null, source = 'operation') {
      failures.set(source, {
        label: refusal ? 'Accès refusé' : 'Enregistrement impossible',
        detail: refusal ?? (remote
          ? 'Le serveur n’a pas confirmé l’enregistrement. Gardez cette page ouverte et réessayez après le rétablissement de la connexion.'
          : 'L’enregistrement sur cet appareil a échoué. Gardez cette page ouverte et vérifiez l’espace disponible.'),
        network: remote && !refusal && error instanceof TypeError,
      });
      paint();
    },
    saved(source = 'operation') { failures.delete(source); paint(); },
  };
}
