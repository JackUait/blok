import { openModalDialog } from '@blok/modal-dialog';
import { CloudClient } from './client';
import { mountShareSheet } from './share-sheet';
import type { RemoteWorkspace } from '../workspace-registry';
import './share-sheet.css';

/**
 * Ouvre la feuille d'accès d'une page.
 *
 * La boîte a besoin de deux niveaux : un voile plein écran qui capte le clic
 * extérieur, et une surface posée dessus. Sans la surface, le contenu se pose à
 * nu sur la page — sans fond, sans marge et sans position.
 */
export function openPageSharing(ref: RemoteWorkspace, pageId: string, pageTitle: string): void {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-desktop-settings-overlay', '');
  overlay.setAttribute('data-cloud-share-overlay', '');
  const surface = document.createElement('section');
  surface.setAttribute('data-cloud-share-dialog', '');
  const heading = document.createElement('h2');
  heading.id = `share-${crypto.randomUUID()}`;
  heading.textContent = `Partager « ${pageTitle} »`;
  surface.append(heading);
  overlay.append(surface);

  const sheet = mountShareSheet(surface, {
    client: new CloudClient({ origin: ref.server }),
    slug: ref.workspaceId,
    pageId,
    pageTitle,
  });
  const dialog = openModalDialog({
    content: overlay,
    surface,
    labelledBy: heading.id,
    onDismiss: () => { dialog.close(); },
    onClose: () => { sheet.destroy(); },
  });
}
