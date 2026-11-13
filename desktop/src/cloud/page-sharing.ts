import { openModalDialog } from '@blok/modal-dialog';
import { promoteToTopLayer, removeFromTopLayer } from '../../../src/components/utils/top-layer';
import { CloudClient } from './client';
import { mountShareSheet } from './share-sheet';
import type { RemoteWorkspace } from '../workspace-registry';
import { nativeSessionAdapter } from '../native-session';
import './share-sheet.css';

let active: { anchor?: HTMLElement; close: () => void } | undefined;

/** Same access sheet in a toolbar popover, or a modal for callers without an anchor. */
export function openPageSharing(ref: RemoteWorkspace, pageId: string, pageTitle: string, anchor?: HTMLButtonElement, onChanged?: () => Promise<void> | void): () => void {
  const same = active?.anchor === anchor && active !== undefined;
  active?.close();
  if (same) return () => {};
  const overlay = document.createElement('div');
  overlay.setAttribute('data-desktop-settings-overlay', '');
  overlay.setAttribute('data-cloud-share-overlay', '');
  const surface = document.createElement('section');
  surface.setAttribute('data-cloud-share-dialog', '');
  surface.setAttribute('role', 'dialog');
  surface.tabIndex = -1;
  const heading = document.createElement('h2');
  heading.id = `share-${crypto.randomUUID()}`;
  heading.textContent = 'Partager';
  surface.setAttribute('aria-labelledby', heading.id);
  const title = document.createElement('p');
  title.setAttribute('data-cloud-share-title', '');
  title.textContent = pageTitle;
  title.title = pageTitle;
  surface.append(heading, title);
  overlay.append(surface);
  const sheet = mountShareSheet(surface, {
    client: new CloudClient({ origin: ref.server, ...('__TAURI_INTERNALS__' in window ? { sessionAdapter: nativeSessionAdapter(ref.server) } : {}) }),
    slug: ref.workspaceId, pageId, pageTitle, onChanged,
  });
  const footer = document.createElement('footer');
  const hint = document.createElement('span');
  hint.textContent = 'Seules les personnes autorisées ont accès.';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Copier le lien';
  copy.addEventListener('click', () => {
    const url = new URL('/', ref.server); url.searchParams.set('page', pageId);
    void navigator.clipboard.writeText(url.href).then(() => { copy.textContent = 'Lien copié'; }, () => { hint.textContent = 'La copie du lien a échoué.'; });
  });
  hint.setAttribute('role', 'status');
  footer.append(hint, copy); surface.append(footer);
  if (!anchor) {
    const dialog = openModalDialog({ content: overlay, surface, labelledBy: heading.id,
      onDismiss: () => dialog.close(), onClose: () => { sheet.destroy(); active = undefined; },
    });
    active = { close: () => dialog.close() };
    return active.close;
  }
  // Keep inherited theme tokens and core popovers in the same UI subtree.
  surface.setAttribute('data-cloud-share-anchored', '');
  anchor.parentElement!.append(surface);
  anchor.setAttribute('aria-expanded', 'true');
  const close = (): void => {
    sheet.destroy(); removeFromTopLayer(surface); surface.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key);
    window.removeEventListener('resize', place);
    if (active?.close === close) active = undefined;
  };
  const outside = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    if (surface.contains(event.target) || anchor.contains(event.target) || event.target.closest('[data-desktop-choice-popover]')) return;
    close();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); anchor.focus(); }
  };
  const place = (): void => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 16);
    surface.style.width = `${width}px`;
    surface.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    surface.style.top = `${rect.bottom + 8}px`;
    surface.style.maxHeight = `${Math.max(100, window.innerHeight - rect.bottom - 16)}px`;
  };
  place(); promoteToTopLayer(surface); surface.focus();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key);
  window.addEventListener('resize', place);
  active = { anchor, close };
  return close;
}
