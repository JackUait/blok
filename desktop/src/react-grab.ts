import type {ReactGrabAPI} from 'react-grab';

export const reactGrabAvailable = import.meta.env.DEV || import.meta.env.VITE_REACT_GRAB === 'true';
let pending: Promise<ReactGrabAPI> | undefined;

/** Explicit initialization also works in the production-built local demo. */
export function loadReactGrab(): Promise<ReactGrabAPI> {
  if (!reactGrabAvailable) return Promise.reject(new Error('React Grab n’est pas activé dans cette version.'));
  pending ??= import('react-grab/core').then(({init}) => {
    const api = init({
      enabled: true,
      telemetry: false,
      activationMode: 'toggle',
      activationKey: (event) => (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyG',
      freezeReactUpdates: false,
      getContent: (elements) => elements.map((element) => {
        if (element.closest('[data-desktop-mcp-secret]')) return '[jeton masqué]';
        const source = element.closest<HTMLElement>('[data-settings-source]')?.dataset.settingsSource;
        const clone = element.cloneNode(true) as Element;
        // Never include field values or a displayed access token in feedback context.
        for (const input of [clone, ...clone.querySelectorAll('input,textarea,[data-desktop-mcp-secret]')]) {
          if (input.matches('input,textarea')) { input.removeAttribute('value'); input.textContent = ''; }
          if (input.matches('[data-desktop-mcp-secret]')) input.textContent = '[jeton masqué]';
        }
        return `${source ? `Source: ${source}\n` : ''}${clone.outerHTML.slice(0, 4000)}`;
      }).join('\n\n'),
    });
    window.__REACT_GRAB__ = api;
    attachGrabToDialogs();
    return api;
  }).catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}

/** Keep the inspector above Blok's top-layer dialogs, inside their focus boundary. */
function attachGrabToDialogs(): void {
  const host = document.querySelector<HTMLElement>('[data-react-grab]');
  if (!host) return;
  const sync = (): void => {
    const surface = document.querySelector<HTMLElement>('[data-custom-emoji-dialog][aria-modal="true"]')
      ?? document.querySelector<HTMLElement>('[data-desktop-settings-dialog][aria-modal="true"]');
    const parent = surface ?? document.body;
    if (host.parentElement !== parent) parent.append(host);
    if (surface && host.inert) host.inert = false;
    if (surface && host.hasAttribute('aria-hidden')) host.removeAttribute('aria-hidden');
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal']});
}
