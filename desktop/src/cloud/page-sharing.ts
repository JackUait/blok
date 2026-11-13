import { openModalDialog } from '@blok/modal-dialog';
import { CloudClient } from './client';
import { mountShareSheet } from './share-sheet';
import type { RemoteWorkspace } from '../workspace-registry';
import './share-sheet.css';

/** Ouvre la feuille d'accès d'une page dans une boîte de dialogue. */
export function openPageSharing(ref: RemoteWorkspace, pageId: string, pageTitle: string): void {
  const host = document.createElement('div');
  host.setAttribute('data-cloud-share-dialog', '');
  const heading = document.createElement('h2');
  heading.id = `share-${crypto.randomUUID()}`;
  heading.textContent = `Partager « ${pageTitle} »`;
  host.prepend(heading);
  const sheet = mountShareSheet(host, {
    client: new CloudClient({ origin: ref.server }),
    slug: ref.workspaceId,
    pageId,
    pageTitle,
  });
  const dialog = openModalDialog({
    content: host,
    labelledBy: heading.id,
    onDismiss: () => { dialog.close(); },
    onClose: () => { sheet.destroy(); },
  });
}
