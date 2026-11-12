import { IconDownload } from '../icons';
import { downloadImage } from '../../tools/image/download';

/** A shared control for page and database covers. Failed external fetches never navigate away. */
export function createCoverDownloadButton(
  source: () => Promise<{ url: string; name?: string }> | { url: string; name?: string },
  label: string,
  failure: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-cover-download', '');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = IconDownload;
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.hidden = true;
  Object.assign(status.style, {
    position: 'absolute', top: 'calc(100% + 8px)', right: '0', width: '240px',
    padding: '8px 12px', borderRadius: '6px', whiteSpace: 'normal',
    background: 'var(--blok-bg-primary, #222)', color: 'var(--blok-text-primary, #fff)',
    boxShadow: '0 2px 12px #0003', fontSize: '12px', lineHeight: '1.5', zIndex: '10',
  });
  button.append(status);
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.hidden = true;
    void Promise.resolve().then(source).then(({url, name}) => downloadImage(url, name, {fallback: false})).catch(() => {
      status.textContent = failure;
      status.hidden = false;
    }).finally(() => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  });
  return button;
}

/** Serialize the colors of a rendered built-in cover as a standalone SVG image. */
export function coverGradientImage(background: string): string {
  const colors = background.match(/#[a-f\d]{3,8}\b|rgba?\([\d.,\s%]+\)/gi) ?? ['#888888'];
  const stops = colors.map((color, index) => `<stop offset="${index / Math.max(1, colors.length - 1) * 100}%" stop-color="${color}"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><linearGradient id="g">${stops}</linearGradient></defs><path fill="url(#g)" d="M0 0h1600v600H0z"/></svg>`)}`;
}
